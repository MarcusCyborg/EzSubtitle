import { TranscriptFetchError, transcriptFromTimedTextBodies } from '../src/lib/transcript/fetch-transcript';
import { transcriptResult } from '../src/lib/transcript/provenance';
import { inspectYoutubeiTranscript } from '../src/lib/transcript/parse-youtubei';
import { inspectNativeTranscript, nativeInspectionSignature, nativePanelIsExpanded, NATIVE_TRANSCRIPT_PANEL_SELECTOR } from '../src/lib/youtube/native-transcript';
import { captionTrackIdentity, captionTrackMatchesVideo, captionTranslation, isCaptionTrack } from '../src/lib/youtube/caption-tracks';
import {
  isPageBridgeResponse,
  PAGE_REQUEST_EVENT,
  PAGE_RESPONSE_EVENT,
  type PageBridgeAction,
  type PageBridgeRequest,
  type PageBridgeResponse,
} from '../src/lib/youtube/page-bridge';
import { captionTracksFromPlayerResponse } from '../src/lib/youtube/caption-tracks';
import { YoutubeTranscriptPanel } from '../src/lib/youtube/youtube-panel';
import { parseVideoId } from '../src/lib/youtube/video-id';
import type { ContentRequest, RuntimeResponse, TranscriptResult, VideoContextResponse } from '../src/types/messages';
import type { CaptionTrack } from '../src/types/transcript';

const PAGE_BRIDGE_TIMEOUT_MS = 15_000;
const NATIVE_BRIDGE_TIMEOUT_MS = 25_000;
let navigationEpoch = 0;

function failure(code: string, message: string): RuntimeResponse<never> {
  return { ok: false, error: { code, message } };
}

function bridgeFailure(response: PageBridgeResponse): TranscriptFetchError {
  if (response.ok) return new TranscriptFetchError('UNPARSEABLE_RESPONSE');
  switch (response.error.code) {
    case 'INVALID_CAPTION_URL': return new TranscriptFetchError('INVALID_CAPTION_URL');
    case 'NETWORK_ERROR': return new TranscriptFetchError('NETWORK_ERROR', response.error.message);
    case 'TRANSCRIPT_ENDPOINT_UNAVAILABLE': return new TranscriptFetchError('TRANSCRIPT_ENDPOINT_UNAVAILABLE', response.error.message);
    case 'EMPTY_RESPONSE': return new TranscriptFetchError('EMPTY_RESPONSE');
    case 'CAPTION_UNAVAILABLE': return new TranscriptFetchError('CAPTION_UNAVAILABLE', response.error.message);
    case 'MISSING_TIMESTAMP': return new TranscriptFetchError('MISSING_TIMESTAMP', response.error.message);
    case 'UNPARSEABLE_RESPONSE': return new TranscriptFetchError('UNPARSEABLE_RESPONSE');
    case 'NATIVE_TRANSCRIPT_UNSTABLE': return new TranscriptFetchError('NATIVE_TRANSCRIPT_UNSTABLE', response.error.message);
    case 'STALE_VIDEO': return new TranscriptFetchError('STALE_VIDEO');
    default: return new TranscriptFetchError('TRANSCRIPT_ENDPOINT_UNAVAILABLE', response.error.message);
  }
}

function requestPageBridge(
  action: 'GET_SNAPSHOT',
  data: Pick<PageBridgeRequest, 'videoId'>,
): Promise<PageBridgeResponse>;
function requestPageBridge(
  action: 'GET_PLAYER_TRANSCRIPT',
  data: Pick<Extract<PageBridgeRequest, { action: 'GET_PLAYER_TRANSCRIPT' }>, 'track' | 'videoId'>,
): Promise<PageBridgeResponse>;
function requestPageBridge(
  action: 'FETCH_TIMEDTEXT',
  data: Pick<Extract<PageBridgeRequest, { action: 'FETCH_TIMEDTEXT' }>, 'baseUrl' | 'videoId'>,
): Promise<PageBridgeResponse>;
function requestPageBridge(
  action: 'FETCH_TRANSCRIPT_ENDPOINT',
  data: Pick<Extract<PageBridgeRequest, { action: 'FETCH_TRANSCRIPT_ENDPOINT' }>, 'track' | 'videoId'>,
): Promise<PageBridgeResponse>;
function requestPageBridge(
  action: 'FETCH_NATIVE_TRANSCRIPT',
  data: Pick<Extract<PageBridgeRequest, { action: 'FETCH_NATIVE_TRANSCRIPT' }>, 'track' | 'videoId' | 'isOnlyTrack'>,
): Promise<PageBridgeResponse>;
function requestPageBridge(
  action: PageBridgeAction,
  data: Omit<PageBridgeRequest, 'requestId' | 'action'>,
): Promise<PageBridgeResponse> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const request: PageBridgeRequest = { requestId, action, ...data } as PageBridgeRequest;
    const timeoutMs = action === 'GET_SNAPSHOT' || action === 'GET_PLAYER_TRANSCRIPT'
      ? 1_000
      : action === 'FETCH_NATIVE_TRANSCRIPT' ? NATIVE_BRIDGE_TIMEOUT_MS : PAGE_BRIDGE_TIMEOUT_MS;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener(PAGE_RESPONSE_EVENT, onResponse);
      window.removeEventListener('yt-navigate-start', onNavigation);
      window.removeEventListener('yt-navigate-finish', onNavigation);
    };
    const onNavigation = () => {
      cleanup();
      resolve({
        requestId,
        action,
        ok: false,
        error: { code: 'STALE_VIDEO', message: 'Video đã thay đổi khi request đang xử lý.' },
      });
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({
        requestId,
        action,
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'Main-world bridge không phản hồi đúng hạn.' },
      });
    }, timeoutMs);
    const onResponse = (event: Event) => {
      if (!(event instanceof CustomEvent) || !isPageBridgeResponse(event.detail, requestId, action)) return;
      cleanup();
      resolve(event.detail);
    };
    window.addEventListener(PAGE_RESPONSE_EVENT, onResponse);
    window.addEventListener('yt-navigate-start', onNavigation, { once: true });
    window.addEventListener('yt-navigate-finish', onNavigation, { once: true });
    window.dispatchEvent(new CustomEvent(PAGE_REQUEST_EVENT, { detail: request }));
  });
}

async function getPlayerTranscript(videoId: string, track: CaptionTrack): Promise<RuntimeResponse<TranscriptResult>> {
  const epoch = navigationEpoch;
  const isCurrent = () => epoch === navigationEpoch && parseVideoId(window.location.href) === videoId;
  const stale = () => failure('STALE_VIDEO', 'Video đã thay đổi khi đọc CC player.');
  if (!isCurrent()) return stale();
  if (!captionTrackMatchesVideo(track, videoId)) return failure('INVALID_CAPTION_URL', 'Đường dẫn không khớp video hoặc track phụ đề.');
  const response = await requestPageBridge('GET_PLAYER_TRANSCRIPT', { videoId, track });
  if (!isCurrent() || (!response.ok && response.error.code === 'STALE_VIDEO')) return stale();
  if (!response.ok || response.action !== 'GET_PLAYER_TRANSCRIPT') return failure('PLAYER_CC_UNAVAILABLE', 'Chưa có CC player phù hợp.');
  const data = transcriptResult(response.data.segments, videoId, track, 'player-timedtext');
  data.provenance.fetchedAt = response.data.observedAt;
  return { ok: true, data };
}

async function getPlayerSnapshot(videoId: string): Promise<unknown | null> {
  for (const delay of [0, 200, 500, 1_000]) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    if (parseVideoId(window.location.href) !== videoId) return null;
    const response = await requestPageBridge('GET_SNAPSHOT', { videoId });
    if (response.ok && response.action === 'GET_SNAPSHOT' && response.data.snapshot) {
      const snapshot = response.data.snapshot as { videoDetails?: { videoId?: unknown } };
      if (snapshot.videoDetails?.videoId === videoId) return snapshot;
    }
  }
  return null;
}

async function getVideoContext(): Promise<VideoContextResponse> {
  const videoId = parseVideoId(window.location.href);
  if (!videoId) return failure('NOT_YOUTUBE_VIDEO', 'Hãy mở một video YouTube để lấy phụ đề.');
  const snapshot = await getPlayerSnapshot(videoId) as { videoDetails?: { videoId?: unknown; title?: unknown } } | null;
  if (parseVideoId(window.location.href) !== videoId) return failure('STALE_VIDEO', 'Video đã thay đổi khi đang đọc dữ liệu player.');
  if (snapshot?.videoDetails?.videoId !== videoId) return failure('STALE_VIDEO', 'YouTube chưa cập nhật dữ liệu player cho video hiện tại.');
  const tracks = captionTracksFromPlayerResponse(snapshot).filter((track) => captionTrackMatchesVideo(track, videoId));
  if (!tracks.length) return failure('NO_CAPTIONS', 'Video này không có phụ đề khả dụng.');
  return {
    ok: true,
    data: {
      videoId,
      title: typeof snapshot?.videoDetails?.title === 'string' ? snapshot.videoDetails.title : document.title,
      url: window.location.href,
      tracks,
    },
  };
}

async function readVisibleSingleTrackTranscript(videoId: string): Promise<TranscriptResult['segments'] | null> {
  const panels = document.querySelectorAll<HTMLElement>(NATIVE_TRANSCRIPT_PANEL_SELECTOR);
  const visiblePanels = Array.from(panels).filter(nativePanelIsExpanded);
  if (visiblePanels.length !== 1) return null;
  const panel = visiblePanels[0]!;
  const isCurrent = () => panel.isConnected
    && parseVideoId(window.location.href) === videoId
    && (!panel.closest('ytd-watch-flexy[video-id]')
      || panel.closest('ytd-watch-flexy[video-id]')?.getAttribute('video-id') === videoId);
  if (!isCurrent()) return null;
  const initial = inspectNativeTranscript(panel);
  if (!initial.segments.length || initial.hasUntimedText || !initial.trackIdentityValid) return null;

  // Isolated scripts can read rendered text even when YouTube's renderer data
  // is unavailable. Require a quiet period before accepting that DOM snapshot.
  let changed = false;
  const invalidate = () => { changed = true; };
  const observer = new MutationObserver(invalidate);
  observer.observe(panel, { childList: true, subtree: true, characterData: true });
  window.addEventListener('yt-navigate-start', invalidate);
  window.addEventListener('yt-navigate-finish', invalidate);
  try {
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    if (changed || !isCurrent() || !nativePanelIsExpanded(panel)) return null;
    const final = inspectNativeTranscript(panel);
    if (final.hasUntimedText || !final.trackIdentityValid
      || nativeInspectionSignature(final) !== nativeInspectionSignature(initial)) return null;
    return final.segments;
  } finally {
    observer.disconnect();
    window.removeEventListener('yt-navigate-start', invalidate);
    window.removeEventListener('yt-navigate-finish', invalidate);
  }
}

async function fetchPageTranscript(videoId: string, track: CaptionTrack, trackCount?: number): Promise<RuntimeResponse<TranscriptResult>> {
  const epoch = navigationEpoch;
  const isCurrent = () => epoch === navigationEpoch && parseVideoId(window.location.href) === videoId;
  const stale = () => failure('STALE_VIDEO', 'Video đã thay đổi khi transcript đang tải.');
  if (!isCurrent()) return stale();
  if (!captionTrackMatchesVideo(track, videoId)) return failure('INVALID_CAPTION_URL', 'Đường dẫn không khớp video hoặc track phụ đề.');
  let timedTextError: TranscriptFetchError | null = null;
  const timedText = await requestPageBridge('FETCH_TIMEDTEXT', { videoId, baseUrl: track.baseUrl });
  if (!isCurrent()) return stale();
  if (timedText.ok && timedText.action === 'FETCH_TIMEDTEXT') {
    if (timedText.data.networkFailure && !timedText.data.bodies.length) {
      timedTextError = new TranscriptFetchError('NETWORK_ERROR');
    } else {
      try {
        const segments = transcriptFromTimedTextBodies(timedText.data.bodies);
        return { ok: true, data: transcriptResult(segments, videoId, track, 'page-timedtext') };
      } catch (error) {
        if (error instanceof TranscriptFetchError) timedTextError = error;
        else return failure('UNPARSEABLE_RESPONSE', 'Không thể đọc response timedtext từ trang YouTube.');
      }
    }
  } else {
    timedTextError = bridgeFailure(timedText);
  }
  if (timedTextError?.code === 'STALE_VIDEO') return stale();
  // Native transcript selectors have no verified translation identity.
  if (captionTranslation(track)) return failure(timedTextError.code, timedTextError.message);

  const fallbackErrors = [timedTextError.code];
  const endpoint = await requestPageBridge('FETCH_TRANSCRIPT_ENDPOINT', {
    videoId,
    track: { id: track.id, languageCode: track.languageCode, label: track.label },
  });
  if (!isCurrent()) return stale();
  let endpointError: TranscriptFetchError;
  if (endpoint.ok && endpoint.action === 'FETCH_TRANSCRIPT_ENDPOINT') {
    const parsed = inspectYoutubeiTranscript(endpoint.data.body);
    if (parsed.segments.length) return { ok: true, data: transcriptResult(parsed.segments, videoId, track, 'youtubei', fallbackErrors) };
    if (!endpoint.data.body.trim()) endpointError = new TranscriptFetchError('EMPTY_RESPONSE');
    else if (parsed.hasText) endpointError = new TranscriptFetchError('MISSING_TIMESTAMP');
    else if (parsed.recognized) endpointError = new TranscriptFetchError('CAPTION_UNAVAILABLE');
    else endpointError = new TranscriptFetchError('UNPARSEABLE_RESPONSE');
  } else {
    endpointError = bridgeFailure(endpoint);
  }
  if (endpointError.code === 'STALE_VIDEO') return failure(endpointError.code, endpointError.message);
  fallbackErrors.push(endpointError.code);

  const snapshot = trackCount === 1 ? await requestPageBridge('GET_SNAPSHOT', { videoId }) : null;
  if (!isCurrent()) return stale();
  const currentTracks = snapshot?.ok && snapshot.action === 'GET_SNAPSHOT'
    && (snapshot.data.snapshot as { videoDetails?: { videoId?: unknown } } | null)?.videoDetails?.videoId === videoId
    ? captionTracksFromPlayerResponse(snapshot.data.snapshot) : [];
  const isOnlyTrack = currentTracks.length === 1 && captionTrackIdentity(currentTracks[0]!) === captionTrackIdentity(track);
  if (isOnlyTrack) {
    const visibleSegments = await readVisibleSingleTrackTranscript(videoId);
    if (!isCurrent()) return stale();
    if (visibleSegments) return { ok: true, data: transcriptResult(visibleSegments, videoId, track, 'native-dom', fallbackErrors) };
  }

  const native = await requestPageBridge('FETCH_NATIVE_TRANSCRIPT', {
    videoId,
    track: { id: track.id, languageCode: track.languageCode, label: track.label },
    isOnlyTrack,
  });
  if (!isCurrent()) return stale();
  if (native.ok && native.action === 'FETCH_NATIVE_TRANSCRIPT' && native.data.segments.length) {
    return { ok: true, data: transcriptResult(native.data.segments, videoId, track, 'native-dom', fallbackErrors) };
  }
  const nativeError = bridgeFailure(native);
  if (nativeError.code === 'STALE_VIDEO') return failure(nativeError.code, nativeError.message);
  const missingTimestamp = [timedTextError, endpointError].find((error) => error?.code === 'MISSING_TIMESTAMP');
  if (missingTimestamp) return failure(missingTimestamp.code, missingTimestamp.message);
  const preferredError = endpointError.code === 'TRANSCRIPT_ENDPOINT_UNAVAILABLE' ? nativeError : endpointError;
  return failure(preferredError.code, preferredError.message);
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://youtube.com/*', 'https://m.youtube.com/*', 'https://youtu.be/*'],
  runAt: 'document_start',
  main() {
    window.addEventListener('yt-navigate-start', () => { navigationEpoch += 1; });
    chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
      if (message?.type === 'GET_VIDEO_CONTEXT') {
        void getVideoContext().then(sendResponse);
        return true;
      }
      if (message?.type === 'GET_PLAYER_TRANSCRIPT' || message?.type === 'FETCH_PAGE_TRANSCRIPT') {
        if (!isCaptionTrack(message.track)) {
          sendResponse(failure('INVALID_REQUEST', 'Yêu cầu lấy phụ đề không hợp lệ.'));
          return;
        }
        const response = message.type === 'GET_PLAYER_TRANSCRIPT'
          ? getPlayerTranscript(message.videoId, message.track)
          : fetchPageTranscript(message.videoId, message.track, message.trackCount);
        void response.then(sendResponse)
          .catch(() => sendResponse(failure('UNEXPECTED_ERROR', 'Không thể đọc transcript từ trang YouTube.')));
        return true;
      }
    });

    window.addEventListener('yt-navigate-finish', () => {
      navigationEpoch += 1;
      const videoId = parseVideoId(window.location.href);
      if (videoId) void chrome.runtime.sendMessage({ type: 'YOUTUBE_NAVIGATED', videoId });
    });

    const panel = new YoutubeTranscriptPanel({
      loadContext: getVideoContext,
      loadTranscript: async (videoId, track, trackCount, bypassCache) => {
        const response = await chrome.runtime.sendMessage({
          type: 'FETCH_TRANSCRIPT', videoId, track, trackCount, ...(bypassCache ? { bypassCache } : {}),
        });
        return response as RuntimeResponse<TranscriptResult>;
      },
    });
    panel.start();
    window.addEventListener('pagehide', () => panel.destroy(), { once: true });
  },
});

export { fetchPageTranscript, getVideoContext, requestPageBridge };
