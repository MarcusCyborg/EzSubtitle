import { captionUrlWithFormat, type TimedTextBody } from '../src/lib/transcript/fetch-transcript';
import { captionUrlMatchesVideoId, captionTracksFromPlayerResponse, isTrustedCaptionUrl } from '../src/lib/youtube/caption-tracks';
import {
  inspectNativeTranscript,
  findNativeTranscriptPanel,
  nativePanelIsExpanded,
  nativeSelectedTab,
  nativeTranscriptTab,
  NATIVE_TRANSCRIPT_PANEL_SELECTOR,
  nativeInspectionSignature,
  nativeMenuEntries,
  nativeMenuIndexForTrack,
  type NativeTranscriptInspection,
} from '../src/lib/youtube/native-transcript';
import {
  isPageBridgeRequest,
  PAGE_REQUEST_EVENT,
  PAGE_RESPONSE_EVENT,
  type PageBridgeFailure,
  type PageBridgeRequest,
  type PageBridgeResponse,
} from '../src/lib/youtube/page-bridge';
import { parsePlayerResponseJson } from '../src/lib/youtube/player-response';
import {
  endpointForTrack,
  inspectTranscriptEndpoints,
  isTranscriptEndpointParams,
  responseMatchesTrack,
} from '../src/lib/youtube/transcript-endpoints';
import { parseVideoId } from '../src/lib/youtube/video-id';

type YouTubeConfig = { get?: (key: string) => unknown };
type YouTubePlayer = HTMLElement & { getPlayerResponse?: () => unknown };
type YouTubeWindow = Window & typeof globalThis & {
  ytInitialData?: unknown;
  ytInitialPlayerResponse?: unknown;
  ytcfg?: YouTubeConfig;
  ytplayer?: { config?: { args?: { player_response?: unknown } } };
};
type RecordValue = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const NATIVE_UI_TIMEOUT_MS = 10_000;
const NATIVE_SETTLE_MS = 650;
const NATIVE_SAMPLE_MS = 100;
const TRANSCRIPT_PANEL_SELECTOR = NATIVE_TRANSCRIPT_PANEL_SELECTOR;

type NativeMenuElement = HTMLElement & { data?: unknown; selected?: unknown };

let nativeTranscriptQueue: Promise<void> = Promise.resolve();
let activeNativeRequest: AbortController | null = null;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractJsonObject(source: string, marker: string): unknown | null {
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const firstBrace = source.indexOf('{', start + marker.length);
  if (firstBrace === -1) return null;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = firstBrace; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return parsePlayerResponseJson(source.slice(firstBrace, index + 1));
    }
  }
  return null;
}

function matchingPlayerSnapshot(value: unknown, videoId: string): unknown | null {
  const response = parsePlayerResponseJson(value);
  return response?.videoDetails?.videoId === videoId ? response : null;
}

function playerSnapshot(videoId: string): unknown | null {
  const page = window as YouTubeWindow;
  const player = document.querySelector<YouTubePlayer>('#movie_player');
  if (typeof player?.getPlayerResponse === 'function') {
    try {
      const current = matchingPlayerSnapshot(player.getPlayerResponse(), videoId);
      if (current) return current;
    } catch (error) {
      console.warn('EzSubtitle could not read the current YouTube player response.', error);
    }
  }
  for (const candidate of [page.ytplayer?.config?.args?.player_response, page.ytInitialPlayerResponse]) {
    const current = matchingPlayerSnapshot(candidate, videoId);
    if (current) return current;
  }
  for (const script of Array.from(document.scripts)) {
    const current = matchingPlayerSnapshot(extractJsonObject(script.textContent ?? '', 'ytInitialPlayerResponse'), videoId);
    if (current) return current;
  }
  return null;
}

function initialDataSnapshot(): unknown | null {
  const page = window as YouTubeWindow;
  if (isRecord(page.ytInitialData)) return page.ytInitialData;
  for (const script of Array.from(document.scripts)) {
    const parsed = extractJsonObject(script.textContent ?? '', 'ytInitialData');
    if (isRecord(parsed)) return parsed;
  }
  return null;
}

function onlyNeededFields(value: unknown, videoId: string): unknown | null {
  const response = matchingPlayerSnapshot(value, videoId);
  if (!response) return null;
  const source = response as {
    videoDetails?: { title?: unknown };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown } };
  };
  const rawTracks = source.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  const captionTracks = Array.isArray(rawTracks) ? rawTracks.slice(0, 100).flatMap((value) => {
    if (!isRecord(value) || typeof value.baseUrl !== 'string' || typeof value.languageCode !== 'string') return [];
    return [{ baseUrl: value.baseUrl, languageCode: value.languageCode, name: value.name, vssId: value.vssId, kind: value.kind }];
  }) : [];
  return {
    videoDetails: {
      videoId,
      title: typeof source.videoDetails?.title === 'string' ? source.videoDetails.title.slice(0, 1_000) : '',
    },
    captions: { playerCaptionsTracklistRenderer: { captionTracks } },
  };
}

function failure(request: PageBridgeRequest, code: string, message: string): PageBridgeFailure {
  return { requestId: request.requestId, action: request.action, ok: false, error: { code, message } };
}

function isCurrentVideo(videoId: string): boolean {
  return parseVideoId(window.location.href) === videoId;
}

function waitForNativeValue<T>(
  read: () => T | null,
  signal: AbortSignal,
  timeoutMs = NATIVE_UI_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: T | null, error?: Error) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value as T);
    };
    const check = () => {
      if (signal.aborted) {
        finish(null, new Error('STALE_VIDEO'));
        return;
      }
      const value = read();
      if (value !== null) finish(value);
    };
    const onAbort = () => finish(null, new Error('STALE_VIDEO'));
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const interval = window.setInterval(check, 100);
    const timeout = window.setTimeout(() => finish(null, new Error('NATIVE_UI_TIMEOUT')), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    check();
  });
}

function transcriptPanel(): HTMLElement | null {
  return findNativeTranscriptPanel(document);
}

function panelIsExpanded(panel: HTMLElement | null): panel is HTMLElement {
  return nativePanelIsExpanded(panel);
}

function transcriptOpenButton(): HTMLElement | null {
  const selectors = [
    'ytd-video-description-transcript-section-renderer button',
    'button[role="tab"][aria-label*="transcript" i]',
    'button[aria-label^="show transcript" i]',
  ];
  for (const selector of selectors) {
    const button = document.querySelector<HTMLElement>(selector);
    if (button && !button.closest(TRANSCRIPT_PANEL_SELECTOR)) return button;
  }
  return nativeTranscriptTab(document);
}

function selectedMenuIndex(menu: NativeMenuElement): number {
  if (typeof menu.selected === 'number' && Number.isInteger(menu.selected)) return menu.selected;
  if (typeof menu.selected === 'string' && /^\d+$/.test(menu.selected)) return Number(menu.selected);
  return nativeMenuEntries(menu.data).findIndex((entry) => entry.selected);
}

class NativeTranscriptStabilityError extends Error {
  constructor(public readonly detail: string) {
    super('NATIVE_TRANSCRIPT_UNSTABLE');
  }
}

function waitForStableNativeTranscript(
  panel: HTMLElement,
  selected: () => boolean,
  signal: AbortSignal,
  options: {
    priorSignature?: string;
    requireChange?: boolean;
    settleMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<NativeTranscriptInspection> {
  const settleMs = options.settleMs ?? NATIVE_SETTLE_MS;
  const timeoutMs = options.timeoutMs ?? NATIVE_UI_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    let stableReads = 0;
    let stableKey = '';
    let observedKey = '';
    let lastChangeAt = performance.now();
    const finish = (inspection: NativeTranscriptInspection | null, error?: Error) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(inspection as NativeTranscriptInspection);
    };
    const check = () => {
      if (signal.aborted) {
        finish(null, new Error('STALE_VIDEO'));
        return;
      }
      const inspection = inspectNativeTranscript(panel);
      const signature = nativeInspectionSignature(inspection);
      const nextObservedKey = [
        inspection.segments.length,
        signature,
        inspection.hasUntimedText,
        inspection.trackIdentityValid,
        inspection.trackKey ?? '',
      ].join('\u0000');
      if (nextObservedKey !== observedKey) {
        observedKey = nextObservedKey;
        lastChangeAt = performance.now();
        stableReads = 0;
        stableKey = '';
      }
      const changed = !options.requireChange || signature !== (options.priorSignature ?? '');
      // YouTube may reuse renderer IDs across languages. A track switch is
      // confirmed by the selected menu and changed, settled content instead.
      const valid = selected()
        && inspection.segments.length > 0
        && !inspection.hasUntimedText
        && inspection.trackIdentityValid
        && changed;
      if (!valid || performance.now() - lastChangeAt < settleMs) {
        stableReads = 0;
        stableKey = '';
        return;
      }
      const nextStableKey = `${inspection.segments.length}\u0000${signature}\u0000${inspection.trackKey ?? ''}`;
      stableReads = nextStableKey === stableKey ? stableReads + 1 : 1;
      stableKey = nextStableKey;
      if (stableReads >= 2) finish(inspection);
    };
    const onAbort = () => finish(null, new Error('STALE_VIDEO'));
    // YouTube updates active/highlight attributes while the video plays. Only
    // parsed transcript changes should restart the quiet-period timer.
    const observer = new MutationObserver(check);
    observer.observe(panel, { childList: true, subtree: true, characterData: true, attributes: true });
    const interval = window.setInterval(check, NATIVE_SAMPLE_MS);
    const timeout = window.setTimeout(() => {
      const inspection = inspectNativeTranscript(panel);
      const reason = !selected() ? 'chưa xác nhận được ngôn ngữ đã chọn'
        : inspection.hasUntimedText ? 'có dòng thiếu mốc thời gian'
          : !inspection.trackIdentityValid ? 'mã dòng phụ đề không đồng nhất'
            : options.requireChange && nativeInspectionSignature(inspection) === (options.priorSignature ?? '')
              ? 'nội dung chưa đổi sau khi chọn ngôn ngữ'
              : 'nội dung vẫn thay đổi';
      finish(null, new NativeTranscriptStabilityError(`${inspection.segments.length} dòng; ${reason}`));
    }, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    check();
  });
}

async function openNativeTranscript(signal: AbortSignal): Promise<{
  panel: HTMLElement;
  wasExpanded: boolean;
  concealment: HTMLStyleElement | null;
  restoreTab: HTMLElement | null;
}> {
  const existing = transcriptPanel();
  if (panelIsExpanded(existing)) {
    const restoreTab = nativeSelectedTab(existing);
    if (!inspectNativeTranscript(existing).hasText) nativeTranscriptTab(existing)?.click();
    return { panel: existing, wasExpanded: true, concealment: null, restoreTab };
  }

  const button = transcriptOpenButton();
  if (!button) throw new Error('NATIVE_PANEL_UNAVAILABLE');
  const concealment = document.createElement('style');
  concealment.textContent = `${TRANSCRIPT_PANEL_SELECTOR}{visibility:hidden!important}`;
  document.documentElement.append(concealment);
  button.click();

  try {
    const panel = await waitForNativeValue(() => {
      const candidate = transcriptPanel();
      return panelIsExpanded(candidate) ? candidate : null;
    }, signal);
    const restoreTab = nativeSelectedTab(panel);
    if (!inspectNativeTranscript(panel).hasText) nativeTranscriptTab(panel)?.click();
    return { panel, wasExpanded: false, concealment, restoreTab };
  } catch (error) {
    concealment.remove();
    throw error;
  }
}

function restoreNativeTranscriptState(
  panel: HTMLElement,
  restoreTab: HTMLElement | null,
  restoreMenu: { menu: NativeMenuElement; index: number } | null,
): void {
  if (restoreMenu && selectedMenuIndex(restoreMenu.menu) !== restoreMenu.index) {
    const target = restoreMenu.menu.querySelectorAll<HTMLElement>('tp-yt-paper-listbox a')[restoreMenu.index];
    if (target) {
      restoreMenu.menu.querySelector<HTMLElement>('#label')?.click();
      target.click();
    }
  }
  if (restoreTab?.isConnected && nativeSelectedTab(panel) !== restoreTab) restoreTab.click();
}

function closeNativeTranscript(panel: HTMLElement, concealment: HTMLStyleElement | null): void {
  panel.querySelector<HTMLElement>('ytd-engagement-panel-title-header-renderer #visibility-button button')?.click();
  concealment?.remove();
}

async function readNativeTranscript(
  request: Extract<PageBridgeRequest, { action: 'FETCH_NATIVE_TRANSCRIPT' }>,
  requestSignal: AbortSignal,
): Promise<PageBridgeResponse> {
  if (!isCurrentVideo(request.videoId)) return failure(request, 'STALE_VIDEO', 'Video đã thay đổi trước khi request bắt đầu.');
  activeNativeRequest?.abort();
  const requestController = new AbortController();
  activeNativeRequest = requestController;
  const abortRequest = () => requestController.abort();
  if (requestSignal.aborted) requestController.abort();
  else requestSignal.addEventListener('abort', abortRequest, { once: true });
  const { signal } = requestController;
  const task = async (): Promise<PageBridgeResponse> => {
    if (signal.aborted || !isCurrentVideo(request.videoId)) {
      return failure(request, 'STALE_VIDEO', 'Video đã thay đổi trước khi transcript native được đọc.');
    }
    let opened: Awaited<ReturnType<typeof openNativeTranscript>> | null = null;
    let restoreMenu: { menu: NativeMenuElement; index: number } | null = null;
    try {
      opened = await openNativeTranscript(signal);
      const { panel } = opened;
      const tracks = captionTracksFromPlayerResponse(playerSnapshot(request.videoId));
      const requestedPlayerIndex = tracks.findIndex((track) => track.id === request.track.id);
      const isOnlyRequestedTrack = request.isOnlyTrack || (tracks.length === 1 && requestedPlayerIndex === 0);
      let menu = isOnlyRequestedTrack ? null : panel.querySelector<NativeMenuElement>('yt-dropdown-menu');
      if (!menu && !isOnlyRequestedTrack) {
        menu = await waitForNativeValue(() => panel.querySelector<NativeMenuElement>('yt-dropdown-menu'), signal);
      }
      if (menu) {
        const initialMenuIndex = selectedMenuIndex(menu);
        if (initialMenuIndex >= 0) restoreMenu = { menu, index: initialMenuIndex };
      }
      const priorInspection = inspectNativeTranscript(panel);
      const priorSignature = nativeInspectionSignature(priorInspection);
      let stableInspection: NativeTranscriptInspection;
      if (!menu) {
        const pending = waitForStableNativeTranscript(panel, () => true, signal);
        if (!priorInspection.segments.length) panel.querySelector<HTMLElement>('#retry-button')?.click();
        stableInspection = await pending;
      } else {
        const entries = nativeMenuEntries(menu.data);
        const targetIndex = nativeMenuIndexForTrack(entries, tracks, request.track);
        if (targetIndex === null) throw new Error('NATIVE_TRACK_UNAVAILABLE');
        if (selectedMenuIndex(menu) !== targetIndex) {
          const items = Array.from(menu.querySelectorAll<HTMLElement>('tp-yt-paper-listbox a'));
          const target = items[targetIndex];
          if (!target) throw new Error('NATIVE_TRACK_UNAVAILABLE');
          const pending = waitForStableNativeTranscript(
            panel,
            () => {
              const currentMenu = panel.querySelector<NativeMenuElement>('yt-dropdown-menu');
              return Boolean(currentMenu && selectedMenuIndex(currentMenu) === targetIndex);
            },
            signal,
            { priorSignature, requireChange: true },
          );
          menu.querySelector<HTMLElement>('#label')?.click();
          target.click();
          stableInspection = await pending;
        } else {
          const pending = waitForStableNativeTranscript(
            panel,
            () => {
              const currentMenu = panel.querySelector<NativeMenuElement>('yt-dropdown-menu');
              return Boolean(currentMenu && selectedMenuIndex(currentMenu) === targetIndex);
            },
            signal,
          );
          if (!priorInspection.segments.length) panel.querySelector<HTMLElement>('#retry-button')?.click();
          stableInspection = await pending;
        }
      }

      if (signal.aborted || !isCurrentVideo(request.videoId)) {
        return failure(request, 'STALE_VIDEO', 'Video đã thay đổi khi transcript native đang tải.');
      }
      return { requestId: request.requestId, action: request.action, ok: true, data: { segments: stableInspection.segments } };
    } catch (error) {
      if (signal.aborted || !isCurrentVideo(request.videoId) || (error instanceof Error && error.message === 'STALE_VIDEO')) {
        return failure(request, 'STALE_VIDEO', 'Video đã thay đổi khi transcript native đang tải.');
      }
      if (error instanceof Error && error.message === 'NATIVE_TRACK_UNAVAILABLE') {
        return failure(request, 'TRANSCRIPT_ENDPOINT_UNAVAILABLE', 'Transcript native không có track đã chọn.');
      }
      if (error instanceof Error && error.message === 'NATIVE_TRANSCRIPT_UNSTABLE') {
        const inspection = opened ? inspectNativeTranscript(opened.panel) : null;
        if (inspection?.hasText && !inspection.segments.length) {
          return failure(request, 'MISSING_TIMESTAMP', 'Transcript native có nội dung nhưng không có timestamp hợp lệ.');
        }
        if (inspection && !inspection.hasText) {
          return failure(request, 'EMPTY_RESPONSE', 'YouTube chưa render segment transcript native.');
        }
        const detail = error instanceof NativeTranscriptStabilityError ? ` (${error.detail})` : '';
        return failure(request, 'NATIVE_TRANSCRIPT_UNSTABLE', `Chưa đọc xong transcript${detail}. Hãy thử lại.`);
      }
      return failure(request, 'TRANSCRIPT_ENDPOINT_UNAVAILABLE', 'YouTube chưa mở được transcript native cho video này.');
    } finally {
      if (opened) {
        if (isCurrentVideo(request.videoId)) {
          restoreNativeTranscriptState(opened.panel, opened.restoreTab, restoreMenu);
          if (!opened.wasExpanded) closeNativeTranscript(opened.panel, opened.concealment);
        } else {
          opened.concealment?.remove();
        }
      }
    }
  };

  const result = nativeTranscriptQueue.then(task, task);
  nativeTranscriptQueue = result.then(() => undefined, () => undefined);
  try {
    return await result;
  } finally {
    requestSignal.removeEventListener('abort', abortRequest);
    if (activeNativeRequest === requestController) activeNativeRequest = null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, requestSignal: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (requestSignal.aborted) controller.abort();
  else requestSignal.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, credentials: 'include', signal: controller.signal });
  } finally {
    requestSignal.removeEventListener('abort', abort);
    window.clearTimeout(timeout);
  }
}

async function boundedText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('RESPONSE_TOO_LARGE');
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new Error('RESPONSE_TOO_LARGE');
  return body;
}

function currentYoutubeConfig(): {
  apiKey: string;
  context: RecordValue;
  clientName: string;
  clientVersion: string;
  visitorData: string | null;
} | null {
  const get = (window as YouTubeWindow).ytcfg?.get;
  if (typeof get !== 'function') return null;
  const apiKey = get('INNERTUBE_API_KEY');
  const context = get('INNERTUBE_CONTEXT');
  const clientName = get('INNERTUBE_CONTEXT_CLIENT_NAME');
  const clientVersion = get('INNERTUBE_CLIENT_VERSION');
  const visitorData = get('VISITOR_DATA');
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 200 || !isRecord(context)
    || (typeof clientName !== 'string' && typeof clientName !== 'number')
    || typeof clientVersion !== 'string' || !clientVersion || clientVersion.length > 100) return null;
  return {
    apiKey,
    context,
    clientName: String(clientName),
    clientVersion,
    visitorData: typeof visitorData === 'string' && visitorData.length <= 2_000 && visitorData ? visitorData : null,
  };
}

async function fetchPageTimedText(request: Extract<PageBridgeRequest, { action: 'FETCH_TIMEDTEXT' }>, signal: AbortSignal): Promise<PageBridgeResponse> {
  if (!isCurrentVideo(request.videoId)) return failure(request, 'STALE_VIDEO', 'Video đã thay đổi trước khi request bắt đầu.');
  if (!isTrustedCaptionUrl(request.baseUrl) || !captionUrlMatchesVideoId(request.baseUrl, request.videoId)) {
    return failure(request, 'INVALID_CAPTION_URL', 'Đường dẫn phụ đề không thuộc video hiện tại.');
  }
  const formats: TimedTextBody['format'][] = ['json3', 'srv3', 'xml'];
  const bodies: TimedTextBody[] = [];
  let failedRequests = 0;
  for (const format of formats) {
    try {
      const response = await fetchWithTimeout(captionUrlWithFormat(request.baseUrl, format), {}, signal);
      if (!isCurrentVideo(request.videoId)) return failure(request, 'STALE_VIDEO', 'Video đã thay đổi khi transcript đang tải.');
      if (response.ok) bodies.push({ format, body: await boundedText(response) });
    } catch (error) {
      if (signal.aborted || !isCurrentVideo(request.videoId)) return failure(request, 'STALE_VIDEO', 'Video đã thay đổi khi transcript đang tải.');
      if (error instanceof Error && error.message === 'RESPONSE_TOO_LARGE') {
        return failure(request, 'UNPARSEABLE_RESPONSE', 'Transcript response vượt quá giới hạn an toàn.');
      }
      failedRequests += 1;
    }
  }
  return { requestId: request.requestId, action: request.action, ok: true, data: { bodies, networkFailure: failedRequests === formats.length } };
}

type YoutubeiConfig = NonNullable<ReturnType<typeof currentYoutubeConfig>>;

async function postTranscriptEndpoint(params: string, config: YoutubeiConfig, signal: AbortSignal): Promise<{ body: string; ok: boolean }> {
  if (!isTranscriptEndpointParams(params)) throw new Error('INVALID_ENDPOINT_PARAMS');
  const url = new URL('/youtubei/v1/get_transcript', window.location.origin);
  url.searchParams.set('prettyPrint', 'false');
  url.searchParams.set('key', config.apiKey);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-youtube-client-name': config.clientName,
    'x-youtube-client-version': config.clientVersion,
  };
  if (config.visitorData) headers['x-goog-visitor-id'] = config.visitorData;
  const response = await fetchWithTimeout(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ context: config.context, params }),
  }, signal);
  return { ok: response.ok, body: await boundedText(response) };
}

function parseYoutubeiBody(body: string): unknown | null {
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

async function fetchTranscriptEndpoint(
  request: Extract<PageBridgeRequest, { action: 'FETCH_TRANSCRIPT_ENDPOINT' }>,
  signal: AbortSignal,
): Promise<PageBridgeResponse> {
  if (!isCurrentVideo(request.videoId)) return failure(request, 'STALE_VIDEO', 'Video đã thay đổi trước khi request bắt đầu.');
  const initialData = initialDataSnapshot();
  const initialEndpoints = initialData ? inspectTranscriptEndpoints(initialData).endpoints : [];
  const initialEndpoint = initialEndpoints.find((candidate) => candidate.selected) ?? initialEndpoints[0] ?? null;
  const config = currentYoutubeConfig();
  if (!initialEndpoint || !config) {
    return failure(request, 'TRANSCRIPT_ENDPOINT_UNAVAILABLE', 'YouTube chưa cung cấp transcript endpoint mặc định.');
  }
  try {
    const defaultResponse = await postTranscriptEndpoint(initialEndpoint.params, config, signal);
    if (signal.aborted || !isCurrentVideo(request.videoId)) return failure(request, 'STALE_VIDEO', 'Video đã thay đổi khi transcript đang tải.');
    if (!defaultResponse.ok) return failure(request, 'TRANSCRIPT_ENDPOINT_UNAVAILABLE', 'Transcript endpoint mặc định của YouTube không khả dụng.');
    if (!defaultResponse.body.trim()) return failure(request, 'EMPTY_RESPONSE', 'YouTube trả về transcript rỗng.');
    const defaultRoot = parseYoutubeiBody(defaultResponse.body);
    if (!defaultRoot) return failure(request, 'UNPARSEABLE_RESPONSE', 'YouTube trả về transcript endpoint không phải JSON hợp lệ.');
    const inspection = inspectTranscriptEndpoints(defaultRoot);
    if (responseMatchesTrack(inspection, request.track)) {
      return { requestId: request.requestId, action: request.action, ok: true, data: { body: defaultResponse.body } };
    }
    const selectedEndpoint = endpointForTrack(inspection, request.track);
    if (!selectedEndpoint || selectedEndpoint.params === initialEndpoint.params) {
      return failure(request, 'TRANSCRIPT_ENDPOINT_UNAVAILABLE', 'Response transcript không có endpoint cho track đã chọn.');
    }
    const selectedResponse = await postTranscriptEndpoint(selectedEndpoint.params, config, signal);
    if (signal.aborted || !isCurrentVideo(request.videoId)) return failure(request, 'STALE_VIDEO', 'Video đã thay đổi khi transcript đang tải.');
    if (!selectedResponse.ok) return failure(request, 'TRANSCRIPT_ENDPOINT_UNAVAILABLE', 'Transcript endpoint của track đã chọn không khả dụng.');
    if (!selectedResponse.body.trim()) return failure(request, 'EMPTY_RESPONSE', 'YouTube trả về transcript rỗng cho track đã chọn.');
    if (!parseYoutubeiBody(selectedResponse.body)) {
      return failure(request, 'UNPARSEABLE_RESPONSE', 'YouTube trả về transcript endpoint không phải JSON hợp lệ.');
    }
    return { requestId: request.requestId, action: request.action, ok: true, data: { body: selectedResponse.body } };
  } catch (error) {
    if (signal.aborted || !isCurrentVideo(request.videoId)) return failure(request, 'STALE_VIDEO', 'Video đã thay đổi khi transcript đang tải.');
    if (error instanceof Error && error.message === 'INVALID_ENDPOINT_PARAMS') {
      return failure(request, 'TRANSCRIPT_ENDPOINT_UNAVAILABLE', 'YouTube cung cấp transcript endpoint không hợp lệ.');
    }
    if (error instanceof Error && error.message === 'RESPONSE_TOO_LARGE') {
      return failure(request, 'UNPARSEABLE_RESPONSE', 'Transcript response vượt quá giới hạn an toàn.');
    }
    return failure(request, 'NETWORK_ERROR', 'Không thể kết nối transcript endpoint của YouTube.');
  }
}

async function handlePageRequest(request: PageBridgeRequest, signal: AbortSignal): Promise<PageBridgeResponse> {
  if (request.action === 'GET_SNAPSHOT') {
    if (!isCurrentVideo(request.videoId)) return failure(request, 'STALE_VIDEO', 'URL video đã thay đổi.');
    return { requestId: request.requestId, action: request.action, ok: true, data: { snapshot: onlyNeededFields(playerSnapshot(request.videoId), request.videoId) } };
  }
  if (request.action === 'FETCH_TIMEDTEXT') return fetchPageTimedText(request, signal);
  if (request.action === 'FETCH_TRANSCRIPT_ENDPOINT') return fetchTranscriptEndpoint(request, signal);
  return readNativeTranscript(request, signal);
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://youtube.com/*', 'https://m.youtube.com/*', 'https://youtu.be/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const activeRequests = new Map<string, AbortController>();
    const abortActiveRequests = () => {
      for (const controller of activeRequests.values()) controller.abort();
      activeRequests.clear();
    };
    const onRequest = (event: Event) => {
      if (!(event instanceof CustomEvent) || !isPageBridgeRequest(event.detail)) return;
      const request = event.detail;
      const controller = new AbortController();
      activeRequests.set(request.requestId, controller);
      void handlePageRequest(request, controller.signal)
        .then((response) => window.dispatchEvent(new CustomEvent(PAGE_RESPONSE_EVENT, { detail: response })))
        .catch((error: unknown) => window.dispatchEvent(new CustomEvent(PAGE_RESPONSE_EVENT, {
          detail: failure(request, 'UNEXPECTED_ERROR', error instanceof Error ? error.message.slice(0, 250) : 'Không thể đọc transcript từ trang YouTube.'),
        })))
        .finally(() => activeRequests.delete(request.requestId));
    };
    const cleanup = () => {
      abortActiveRequests();
      window.removeEventListener(PAGE_REQUEST_EVENT, onRequest);
      window.removeEventListener('yt-navigate-start', abortActiveRequests);
      window.removeEventListener('yt-navigate-finish', abortActiveRequests);
    };
    window.addEventListener(PAGE_REQUEST_EVENT, onRequest);
    window.addEventListener('yt-navigate-start', abortActiveRequests);
    window.addEventListener('yt-navigate-finish', abortActiveRequests);
    window.addEventListener('pagehide', cleanup, { once: true });
  },
});

export { handlePageRequest, playerSnapshot, waitForStableNativeTranscript };
