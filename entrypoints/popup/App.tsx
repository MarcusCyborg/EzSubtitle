import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusMessage } from '../../src/components/StatusMessage';
import { TrackSelector } from '../../src/components/TrackSelector';
import { TranscriptPreview } from '../../src/components/TranscriptPreview';
import { DEFAULT_OUTPUT_FORMAT, getStoredOutputFormat, storeOutputFormat } from '../../src/lib/storage/output-format';
import { copyTranscriptText, downloadTranscriptText } from '../../src/lib/transcript/actions';
import { formatTranscript } from '../../src/lib/transcript/format';
import { selectDefaultTrack } from '../../src/lib/youtube/caption-tracks';
import { isYouTubeVideoUrl } from '../../src/lib/youtube/video-id';
import type { ContentRequest, RuntimeResponse, TranscriptResult, VideoContextResponse } from '../../src/types/messages';
import type { CaptionTrack, TranscriptOutputMode, VideoContext } from '../../src/types/transcript';
import './App.css';

const LONG_TRANSCRIPT_CHARS = 20_000;
type Feedback = { kind: 'info' | 'error'; text: string } | null;

function extensionError(): string {
  return chrome.runtime.lastError?.message ?? 'Không thể kết nối với trang YouTube. Hãy tải lại trang rồi thử lại.';
}

export default function App() {
  const [context, setContext] = useState<VideoContext | null>(null);
  const [track, setTrack] = useState<CaptionTrack | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [outputMode, setOutputMode] = useState<TranscriptOutputMode>(DEFAULT_OUTPUT_FORMAT);
  const requestSequence = useRef(0);
  const sourceTabId = useRef<number | null>(null);
  const outputText = useMemo(() => (
    transcript ? formatTranscript(transcript.segments, outputMode) : ''
  ), [outputMode, transcript]);

  const loadTrack = useCallback(async (video: VideoContext, selectedTrack: CaptionTrack, tabId = sourceTabId.current) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setTranscript(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_TRANSCRIPT', videoId: video.videoId, track: selectedTrack, trackCount: video.tracks.length,
        ...(typeof tabId === 'number' ? { tabId } : {}),
      }) as RuntimeResponse<TranscriptResult>;
      if (sequence !== requestSequence.current) return;
      if (!response?.ok) throw new Error(response?.error.message ?? 'Không thể tải phụ đề lúc này.');
      setTranscript(response.data);
    } catch (reason) {
      if (sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : 'Không thể tải phụ đề lúc này.');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  const loadContext = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setContext(null);
    setTrack(null);
    setTranscript(null);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (sequence !== requestSequence.current) return;
      if (typeof tab?.id !== 'number' || !tab.url || !isYouTubeVideoUrl(tab.url)) throw new Error('Hãy mở một video YouTube để lấy phụ đề.');
      sourceTabId.current = tab.id;
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_CONTEXT' } satisfies ContentRequest) as VideoContextResponse;
      if (sequence !== requestSequence.current) return;
      if (!response?.ok) throw new Error(response?.error.message ?? extensionError());
      const initialTrack = selectDefaultTrack(response.data.tracks);
      if (!initialTrack) throw new Error('Video này không có phụ đề khả dụng.');
      setContext(response.data);
      setTrack(initialTrack);
      await loadTrack(response.data, initialTrack, tab.id);
    } catch (reason) {
      if (sequence !== requestSequence.current) return;
      setError(reason instanceof Error ? reason.message : 'Đã xảy ra lỗi không mong muốn.');
      setLoading(false);
    }
  }, [loadTrack]);

  useEffect(() => {
    void getStoredOutputFormat().then(setOutputMode).catch(() => undefined);
    void loadContext();
    const listener = (message: { type?: string }) => {
      if (message.type === 'VIDEO_CONTEXT_INVALIDATED') void loadContext();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [loadContext]);

  const changeTrack = (nextTrack: CaptionTrack) => {
    if (!context) return;
    setTrack(nextTrack);
    void loadTrack(context, nextTrack);
  };

  const copyTranscript = async () => {
    if (!transcript) return;
    try {
      await copyTranscriptText(outputText);
      setFeedback({ kind: 'info', text: 'Đã sao chép subtitle.' });
    } catch {
      setFeedback({ kind: 'error', text: 'Không thể sao chép. Hãy thử lại.' });
    }
  };

  const downloadTranscript = () => {
    if (!transcript || !context || !track) return;
    try {
      downloadTranscriptText(outputText, context.title, track.languageCode);
      setFeedback({ kind: 'info', text: 'Đã bắt đầu tải file .txt.' });
    } catch {
      setFeedback({ kind: 'error', text: 'Không thể tải file. Hãy thử lại.' });
    }
  };

  const prepareChatGpt = async () => {
    if (!transcript) return;
    if (outputText.length >= LONG_TRANSCRIPT_CHARS) {
      const accepted = window.confirm(`Transcript có ${outputText.length.toLocaleString('vi-VN')} ký tự và sẽ được chuyển nguyên vẹn sang ChatGPT. Bạn có muốn tiếp tục?`);
      if (!accepted) return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PREPARE_CHATGPT_DRAFT', transcript: outputText }) as RuntimeResponse<{ tabId: number }>;
      if (!response?.ok) throw new Error(response?.error.message ?? 'Không thể mở ChatGPT.');
      setFeedback({ kind: 'info', text: 'Đã mở ChatGPT. Extension sẽ không tự gửi tin nhắn.' });
    } catch (reason) {
      setFeedback({ kind: 'error', text: reason instanceof Error ? reason.message : 'Không thể mở ChatGPT.' });
    }
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="brand-mark" aria-hidden="true">E</div>
        <div><h1>EzSubtitle</h1><p>Subtitle gọn, nguyên vẹn, đúng mốc thời gian.</p></div>
      </header>
      {loading && <StatusMessage kind="loading">Đang tìm phụ đề…</StatusMessage>}
      {!loading && error && <section className="error-state"><StatusMessage kind="error">{error}</StatusMessage><button className="button button--secondary" type="button" onClick={() => void loadContext()}>Thử lại</button></section>}
      {context && track && !error && <section className="workspace">
        <TrackSelector tracks={context.tracks} selectedTrack={track} disabled={loading} onChange={changeTrack} />
        <label className="output-selector">
          <span>Định dạng xuất</span>
          <select
            value={outputMode}
            onChange={(event) => {
              const mode = event.target.value as TranscriptOutputMode;
              setOutputMode(mode);
              void storeOutputFormat(mode).catch(() => setFeedback({ kind: 'error', text: 'Không thể lưu định dạng xuất.' }));
            }}
          >
            <option value="readable">Dễ đọc</option>
            <option value="detailed">Chi tiết</option>
          </select>
        </label>
        {transcript && <TranscriptPreview text={outputText} segmentCount={transcript.segments.length} />}
        {transcript && <div className="actions">
          <button className="button button--secondary" type="button" onClick={() => void copyTranscript()}>Sao chép subtitle</button>
          <button className="button button--secondary" type="button" onClick={downloadTranscript}>Tải file .txt</button>
          <button className="button button--primary" type="button" onClick={() => void prepareChatGpt()}>Tóm tắt bằng ChatGPT</button>
        </div>}
      </section>}
      {feedback && <StatusMessage kind={feedback.kind}>{feedback.text}</StatusMessage>}
      <footer>EzSubtitle chỉ chuyển transcript sang ChatGPT khi bạn bấm nút tóm tắt.</footer>
    </main>
  );
}
