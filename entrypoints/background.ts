import { buildSummaryPrompt } from '../src/lib/chatgpt/build-summary-prompt';
import { fetchTranscriptForTrack, TranscriptFetchError } from '../src/lib/transcript/fetch-transcript';
import { formatTranscript } from '../src/lib/transcript/format';
import { cacheTranscript, getCachedTranscript } from '../src/lib/storage/transcript-cache';
import { transcriptResult } from '../src/lib/transcript/provenance';
import { attachDraftToTab, claimDraftForTab, createPendingDraft, removeClaimedDraft } from '../src/lib/storage/pending-draft';
import { captionTrackMatchesVideo, captionTranslation, isCaptionTrack } from '../src/lib/youtube/caption-tracks';
import { isValidVideoId, parseVideoId } from '../src/lib/youtube/video-id';
import type { RuntimeRequest, RuntimeResponse, TranscriptResult } from '../src/types/messages';
import type { CaptionTrack } from '../src/types/transcript';

function failure(code: string, message: string): RuntimeResponse<never> {
  return { ok: false, error: { code, message } };
}

function probePlayerTranscript(tabId: number, videoId: string, track: CaptionTrack, navigation: AbortSignal) {
  const signal = AbortSignal.any([navigation, AbortSignal.timeout(1_500)]);
  return new Promise<RuntimeResponse<TranscriptResult> | null>((resolve) => {
    if (signal.aborted) return resolve(null);
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    const finish = (response: RuntimeResponse<TranscriptResult> | null) => {
      signal.removeEventListener('abort', onAbort);
      resolve(response);
    };
    void chrome.tabs.sendMessage(tabId, { type: 'GET_PLAYER_TRANSCRIPT', videoId, track })
      .then(finish, () => finish(null));
  });
}

async function handleFetchTranscript(
  videoId: string,
  track: unknown,
  sender: chrome.runtime.MessageSender,
  requestedTabId?: number,
  trackCount?: number,
  bypassCache = false,
): Promise<RuntimeResponse<TranscriptResult>> {
  if (!isValidVideoId(videoId) || !isCaptionTrack(track)) {
    return failure('INVALID_REQUEST', 'Yêu cầu lấy phụ đề không hợp lệ.');
  }
  if (!captionTrackMatchesVideo(track, videoId)) {
    return failure('INVALID_CAPTION_URL', 'Đường dẫn không khớp video hoặc track phụ đề.');
  }
  const tabId = typeof sender.tab?.id === 'number'
    ? sender.tab.id
    : Number.isInteger(requestedTabId) && (requestedTabId as number) >= 0 ? requestedTabId as number : null;
  if (tabId === null) return failure('INVALID_TAB', 'Không xác định được tab YouTube nguồn.');

  const navigation = new AbortController();
  const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (id, change) => {
    if (id === tabId && (change.status === 'loading' || (change.url && parseVideoId(change.url) !== videoId))) navigation.abort();
  };
  const onRemoved = (id: number) => { if (id === tabId) navigation.abort(); };
  chrome.tabs.onUpdated?.addListener(onUpdated);
  chrome.tabs.onRemoved?.addListener(onRemoved);
  const tabStillOnVideo = async (): Promise<boolean> => {
    try {
      const tab = await chrome.tabs.get(tabId);
      return !navigation.signal.aborted && typeof tab.url === 'string' && parseVideoId(tab.url) === videoId;
    } catch {
      return false;
    }
  };
  const stale = () => failure('STALE_VIDEO', 'Tab YouTube đã chuyển sang video khác.');
  const matchesSelection = (data: TranscriptResult) => {
    const provenance = data?.provenance;
    return provenance && provenance.videoId === videoId && provenance.trackId === track.id
      && provenance.languageCode === track.languageCode && provenance.translation === captionTranslation(track);
  };
  const complete = async (data: TranscriptResult): Promise<RuntimeResponse<TranscriptResult>> => {
    if (!await tabStillOnVideo()) return stale();
    if (data.provenance.source !== 'player-timedtext' && !data.provenance.cacheHit) {
      await cacheTranscript(track, tabId, data).catch(() => undefined);
    }
    if (navigation.signal.aborted) return stale();
    return { ok: true, data: data.provenance.source === 'player-timedtext' ? data : {
      ...data, provenance: { ...data.provenance, fallbackErrors: ['PLAYER_CC_UNAVAILABLE', ...data.provenance.fallbackErrors] },
    } };
  };
  try {
    if (!await tabStillOnVideo()) return stale();
    // A current player response can replace even a successful metadata cache hit.
    const player = await probePlayerTranscript(tabId, videoId, track, navigation.signal).catch(() => null);
    if (navigation.signal.aborted || (player?.ok === false && player.error?.code === 'STALE_VIDEO')) return stale();
    if (player?.ok && matchesSelection(player.data) && player.data.provenance.source === 'player-timedtext'
      && !player.data.provenance.cacheHit && player.data.segments?.length > 0) return await complete(player.data);
    const cached = bypassCache === true ? null : await getCachedTranscript(videoId, track, tabId).catch(() => null);
    if (cached) return await complete({ ...cached, text: formatTranscript(cached.segments) });
    let directError: TranscriptFetchError;
    try {
      const signal = AbortSignal.any([navigation.signal, AbortSignal.timeout(8_000)]);
      const segments = await fetchTranscriptForTrack(track, fetch, signal);
      return await complete(transcriptResult(segments, videoId, track, 'background-timedtext'));
    } catch (error) {
      if (navigation.signal.aborted) return stale();
      if (!(error instanceof TranscriptFetchError)) return failure('CAPTION_UNAVAILABLE', 'Không thể tải phụ đề lúc này. Hãy thử lại.');
      if (error.code === 'INVALID_CAPTION_URL') return failure(error.code, error.message);
      directError = error;
    }
    try {
      const fallback = await chrome.tabs.sendMessage(tabId, {
        type: 'FETCH_PAGE_TRANSCRIPT', videoId, track,
        ...(Number.isInteger(trackCount) && (trackCount as number) > 0 && (trackCount as number) <= 100 ? { trackCount } : {}),
      }) as RuntimeResponse<TranscriptResult>;
      if (!fallback?.ok) return failure(fallback?.error.code ?? directError.code, fallback?.error.message ?? directError.message);
      const provenance = fallback.data.provenance;
      if (!matchesSelection(fallback.data)
        || !['page-timedtext', 'youtubei', 'native-dom'].includes(provenance.source)) {
        return failure('CAPTION_UNAVAILABLE', 'Kết quả dự phòng không khớp track nguồn.');
      }
      return await complete({
        ...fallback.data,
        provenance: { ...provenance, fallbackErrors: [directError.code, ...provenance.fallbackErrors] },
      });
    } catch {
      if (navigation.signal.aborted) return stale();
      return failure(directError.code, directError.message);
    }
  } finally {
    chrome.tabs.onUpdated?.removeListener(onUpdated);
    chrome.tabs.onRemoved?.removeListener(onRemoved);
  }
}

async function handlePrepareDraft(transcript: unknown): Promise<RuntimeResponse<{ tabId: number }>> {
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return failure('EMPTY_TRANSCRIPT', 'Chưa có phụ đề để tóm tắt.');
  }
  const draft = await createPendingDraft(buildSummaryPrompt(transcript));
  const tab = await chrome.tabs.create({ url: 'https://chatgpt.com/' });
  if (typeof tab.id !== 'number') return failure('CHATGPT_TAB_FAILED', 'Không thể mở tab ChatGPT.');
  await attachDraftToTab(draft.token, tab.id);
  return { ok: true, data: { tabId: tab.id } };
}

async function handleMessage(
  message: RuntimeRequest,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse<unknown>> {
  switch (message.type) {
    case 'FETCH_TRANSCRIPT':
      return handleFetchTranscript(message.videoId, message.track, sender, message.tabId, message.trackCount, message.bypassCache);
    case 'PREPARE_CHATGPT_DRAFT':
      return handlePrepareDraft(message.transcript);
    case 'CLAIM_CHATGPT_DRAFT': {
      if (typeof sender.tab?.id !== 'number') return failure('INVALID_TAB', 'Không xác định được tab ChatGPT.');
      const draft = await claimDraftForTab(sender.tab.id);
      return { ok: true, data: draft ? { token: draft.token, content: draft.content } : null };
    }
    case 'MARK_CHATGPT_DRAFT_FILLED': {
      if (typeof sender.tab?.id !== 'number') return failure('INVALID_TAB', 'Không xác định được tab ChatGPT.');
      await removeClaimedDraft(message.token, sender.tab.id);
      return { ok: true, data: null };
    }
    case 'YOUTUBE_NAVIGATED':
      // Popups can discard stale state immediately after YouTube's SPA changes video.
      void chrome.runtime.sendMessage({ type: 'VIDEO_CONTEXT_INVALIDATED', videoId: message.videoId }).catch(() => undefined);
      return { ok: true, data: null };
  }
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') return;
    const typedMessage = message as RuntimeRequest;
    void handleMessage(typedMessage, sender)
      .then(sendResponse)
      .catch(() => sendResponse(failure('UNEXPECTED_ERROR', 'Đã xảy ra lỗi không mong muốn.')));
    return true;
  });
});

export { handleFetchTranscript };
