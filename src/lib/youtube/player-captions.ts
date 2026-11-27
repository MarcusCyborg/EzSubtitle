import type { CaptionTrack, TranscriptSegment } from '../../types/transcript';
import { MAX_RESPONSE_BYTES, readBoundedText } from '../transcript/bounded-response';
import { TranscriptFetchError, transcriptFromTimedTextBodies, type TimedTextFormat } from '../transcript/fetch-transcript';
import { CAPTION_METADATA_OPTIONS, captionRequestMatchesTrack, captionTrackIdentity, captionUrlMatchesVideoId } from './caption-tracks';

export const PLAYER_CC_DIAGNOSTIC_EVENT = 'ezsubtitle:diagnose-player-cc';
const CAPTURE_TIMEOUT_MS = 12_000;
const MAX_AGE_MS = 30 * 60_000;
const TIMEDTEXT_PARAMS = new Set([
  'v', 'lang', 'kind', 'name', 'tlang', 'variant', 'track', 'vssId', 'fmt',
  ...CAPTION_METADATA_OPTIONS,
  'expire', 'ei', 'ip', 'ipbits', 'sparams', 'signature', 'sig', 'lsig', 'key', 'caps', 'opi',
  'c', 'cver', 'cbrand', 'cmodel', 'cplatform', 'cplayer', 'cos', 'cosver', 'hl', 'pot', 'potc',
]);

type Capture = { segments: TranscriptSegment[]; observedAt: number };
type Attempt = {
  videoId: string;
  identity: string;
  controller: AbortController;
  capture: Capture | null;
};
type Diagnostic = { transport: 'fetch' | 'xhr'; result: string; format?: TimedTextFormat; status?: number; cues?: number };
type Hook = (...args: never[]) => unknown;
type OpenRequest = { url: URL; generation: number; range: boolean };

export function fromPlayerBundle(externalFrame: string, origin: string): boolean {
  const script = externalFrame.match(/(https:\/\/[^\s()]+):\d+:\d+\)?\s*$/)?.[1];
  if (!script) return false;
  try {
    const url = new URL(script);
    return url.origin === origin && /^\/s\/player\/[\w./-]+\/(?:base|player_ias(?:\.vflset)?)\.js$/.test(url.pathname);
  } catch {
    return false;
  }
}

function responseFormat(url: URL): TimedTextFormat | null {
  const fmt = url.searchParams.get('fmt');
  if (url.searchParams.getAll('fmt').length > 1) return null;
  return fmt === 'json3' || fmt === 'srv3' ? fmt : fmt === null ? 'xml' : null;
}

function parseCapture(body: string, format: TimedTextFormat): TranscriptSegment[] {
  // Accept only the known whole-track document envelopes. Skip unfamiliar or
  // paged bodies rather than exporting a single chunk as the whole transcript.
  if (format === 'json3' && body.trim()) {
    const root = JSON.parse(body) as Record<string, unknown> | null;
    const keys = ['wireMagic', 'pens', 'wsWinStyles', 'wpWinPositions', 'events'];
    if (!root || Object.keys(root).some((key) => !keys.includes(key))
      || /"(?:\w*continuation\w*|segmentIndex|chunkIndex|nextPageToken)"\s*:/i.test(body)) throw new Error('UNSUPPORTED_BODY');
  } else if (body.trim()) {
    const root = format === 'srv3' ? 'timedtext' : 'transcript';
    if (!new RegExp(`^(?:<\\?xml[^>]*\\?>\\s*)?<${root}(?:\\s|>)`).test(body.trim())
      || /<\/?[\w:-]*(?:continuation|chunk|segment)[\w:-]*[\s/>]/i.test(body)) throw new Error('UNSUPPORTED_BODY');
  }
  const segments = transcriptFromTimedTextBodies([{ body, format }]);
  if (segments.length > 20_000 || segments.some(({ text }) => text.length > 10_000)) throw new Error('RESPONSE_TOO_LARGE');
  return segments;
}

export function observePlayerCaptions(
  page: Window & typeof globalThis,
  currentVideo: () => string | null,
  tracksForVideo: (videoId: string) => CaptionTrack[],
  initiator = (wrapper: Hook) => {
    // Skip our own stack frames by function identity, even in the bundled build.
    const error = new Error();
    if (typeof Error.captureStackTrace !== 'function') return false;
    Error.captureStackTrace(error, wrapper);
    return fromPlayerBundle(error.stack?.split('\n')[1] ?? '', page.location.origin);
  },
) {
  const nativeFetch = page.fetch;
  const xhr = page.XMLHttpRequest.prototype;
  const nativeOpen = xhr.open;
  const nativeSend = xhr.send;
  const nativeSetHeader = xhr.setRequestHeader;
  let latest: Attempt | null = null;
  let generation = 0;
  let navigating = false;
  let activeVideo = currentVideo();
  let opened = new WeakMap<XMLHttpRequest, OpenRequest>();
  const diagnostics: Diagnostic[] = [];
  const note = (entry: Diagnostic) => {
    if (diagnostics.length >= 12) diagnostics.shift();
    diagnostics.push(entry);
  };
  const invalidate = () => {
    generation += 1;
    latest?.controller.abort();
    latest = null;
    opened = new WeakMap();
    diagnostics.length = 0;
  };

  const synchronizeVideo = () => {
    const videoId = currentVideo();
    if (videoId !== activeVideo) {
      invalidate();
      activeVideo = videoId;
    }
    return videoId;
  };
  const candidate = (input: string, transport: Diagnostic['transport'], wrapper: Hook): URL | null => {
    if (input.length > 8_000 || !input.includes('/api/timedtext')) return null;
    const videoId = synchronizeVideo();
    const url = new URL(input, page.location.href);
    if (navigating || !videoId || !captionUrlMatchesVideoId(url.href, videoId)) return null;
    if (!initiator(wrapper)) {
      note({ transport, result: 'INITIATOR_UNCONFIRMED' });
      return null;
    }
    return url;
  };

  const begin = (url: URL, transport: Diagnostic['transport'], range: boolean) => {
    const videoId = synchronizeVideo();
    if (navigating || !videoId || !captionUrlMatchesVideoId(url.href, videoId)) return null;
    latest?.controller.abort();
    latest = null;
    const format = responseFormat(url);
    if (!format || range || Array.from(url.searchParams.keys()).some((key) => !TIMEDTEXT_PARAMS.has(key))) {
      note({ transport, result: 'UNSUPPORTED_REQUEST_SCOPE' });
      return null;
    }
    const tracks = tracksForVideo(videoId).filter((track) => captionRequestMatchesTrack(url, track, videoId));
    if (tracks.length !== 1) {
      note({ transport, result: 'TRACK_UNCONFIRMED', format });
      return null;
    }
    const attempt: Attempt = { videoId, identity: captionTrackIdentity(tracks[0]!), controller: new AbortController(), capture: null };
    latest = attempt;
    const active = () => latest === attempt && !navigating && currentVideo() === videoId && !attempt.controller.signal.aborted;
    const signal = AbortSignal.any([attempt.controller.signal, AbortSignal.timeout(CAPTURE_TIMEOUT_MS)]);
    let settled = false;
    signal.addEventListener('abort', () => {
      if (active() && !settled) note({ transport, format, result: 'CAPTURE_TIMEOUT' });
    }, { once: true });
    const report = (result: string, status?: number, cues?: number) => {
      if (!settled && active() && !signal.aborted) note({ transport, format, result, status, cues });
      settled = true;
    };
    const accept = (body: string, status: number) => {
      if (signal.aborted || !active()) return;
      try {
        const segments = parseCapture(body, format);
        attempt.capture = { segments, observedAt: Date.now() };
        report('CAPTURED', status, segments.length);
      } catch (error) {
        const result = error instanceof TranscriptFetchError ? error.code
          : error instanceof Error && error.message === 'RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : 'UNSUPPORTED_BODY';
        report(result, status);
      }
    };
    const responseMatches = (responseUrl: string, status: number, hasRange: boolean) => {
      if (!active() || signal.aborted) return false;
      if (status !== 200 || hasRange || responseUrl !== url.href) {
        report('RESPONSE_REJECTED', status);
        return false;
      }
      return true;
    };
    return { signal, accept, report, responseMatches };
  };

  const fetchHook: typeof fetch = function (this: Window, ...args: Parameters<typeof fetch>) {
    const pending = Reflect.apply(nativeFetch, this, args) as Promise<Response>;
    try {
      const [input, init] = args;
      const request = input instanceof page.Request ? input : null;
      const url = candidate(request?.url ?? String(input), 'fetch', fetchHook);
      if (!url || (init?.method ?? request?.method ?? 'GET').toUpperCase() !== 'GET') return pending;
      const attempt = begin(url, 'fetch', new Headers(init?.headers ?? request?.headers).has('range'));
      if (attempt) void pending.then(async (response) => {
        if (!attempt.responseMatches(response.url, response.status, response.redirected || response.headers.has('content-range'))) return;
        const { body } = await readBoundedText(response.clone(), attempt.signal);
        attempt.accept(body, response.status);
      }).catch((error: unknown) => attempt.report(
        error instanceof Error && error.message === 'RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : 'NETWORK_ERROR',
      ));
    } catch { /* Do not alter the player's request path if inspection fails. */ }
    return pending;
  };

  const openHook = function (this: XMLHttpRequest, ...args: Parameters<typeof xhr.open>) {
    Reflect.apply(nativeOpen, this, args);
    opened.delete(this);
    try {
      const [method, input] = args;
      const url = method.toUpperCase() === 'GET' ? candidate(String(input), 'xhr', openHook) : null;
      if (url) opened.set(this, { url, generation, range: false });
    } catch { /* Inspection is best effort. */ }
  } as typeof xhr.open;
  const setHeaderHook = function (this: XMLHttpRequest, name: string, value: string) {
    nativeSetHeader.call(this, name, value);
    const request = opened.get(this);
    if (request && typeof name === 'string' && name.toLowerCase() === 'range') request.range = true;
  };
  const sendHook = function (this: XMLHttpRequest, ...args: Parameters<typeof xhr.send>) {
    const request = opened.get(this);
    opened.delete(this);
    try {
      const observation = request?.generation === generation ? begin(request.url, 'xhr', request.range) : null;
      if (observation) this.addEventListener('loadend', () => {
        try {
          if (!observation.responseMatches(this.responseURL, this.status, this.getResponseHeader('content-range') !== null)) return;
          if (Number(this.getResponseHeader('content-length')) > MAX_RESPONSE_BYTES) {
            observation.report('RESPONSE_TOO_LARGE', this.status);
            return;
          }
          if (this.responseType !== '' && this.responseType !== 'text') {
            observation.report('UNSUPPORTED_XHR_BODY', this.status);
            return;
          }
          const body = this.responseText;
          if (body.length > MAX_RESPONSE_BYTES || new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
            observation.report('RESPONSE_TOO_LARGE', this.status);
            return;
          }
          observation.accept(body, this.status);
        } catch { observation.report('UNSUPPORTED_XHR_BODY'); }
      }, { once: true, signal: observation.signal });
    } catch { /* The native send must still run if inspection fails. */ }
    return Reflect.apply(nativeSend, this, args);
  } as typeof xhr.send;

  page.fetch = fetchHook;
  xhr.open = openHook;
  xhr.setRequestHeader = setHeaderHook;
  xhr.send = sendHook;

  return {
    // Always bypass our hook for extension page requests, including any future replay.
    extensionFetch: nativeFetch?.bind(page) ?? fetch,
    startNavigation() { navigating = true; invalidate(); },
    finishNavigation() { synchronizeVideo(); navigating = false; },
    read(videoId: string, track: CaptionTrack) {
      if (navigating || synchronizeVideo() !== videoId || !latest || latest.videoId !== videoId
        || latest.identity !== captionTrackIdentity(track) || !latest.capture) return null;
      const age = Date.now() - latest.capture.observedAt;
      if (age < 0 || age >= MAX_AGE_MS) {
        invalidate();
        return null;
      }
      const matchingTracks = tracksForVideo(videoId).filter((candidate) => candidate.id === track.id
        && captionTrackIdentity(candidate) === latest?.identity);
      if (matchingTracks.length !== 1) return null;
      return latest.capture;
    },
    diagnostics: () => [...diagnostics],
    dispose() {
      invalidate();
      if (page.fetch === fetchHook) page.fetch = nativeFetch;
      if (xhr.open === openHook) xhr.open = nativeOpen;
      if (xhr.setRequestHeader === setHeaderHook) xhr.setRequestHeader = nativeSetHeader;
      if (xhr.send === sendHook) xhr.send = nativeSend;
    },
  };
}
