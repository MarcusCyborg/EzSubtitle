import type { TimedTextBody } from '../transcript/fetch-transcript';
import type { TranscriptSegment } from '../../types/transcript';

export const PAGE_REQUEST_EVENT = 'ezsubtitle:page-request';
export const PAGE_RESPONSE_EVENT = 'ezsubtitle:page-response';

export type PageBridgeAction = 'GET_SNAPSHOT' | 'FETCH_TIMEDTEXT' | 'FETCH_TRANSCRIPT_ENDPOINT' | 'FETCH_NATIVE_TRANSCRIPT';

export type PageBridgeTrack = { id: string; languageCode: string; label: string };

export type PageBridgeRequest =
  | { requestId: string; action: 'GET_SNAPSHOT'; videoId: string }
  | { requestId: string; action: 'FETCH_TIMEDTEXT'; videoId: string; baseUrl: string }
  | { requestId: string; action: 'FETCH_TRANSCRIPT_ENDPOINT'; videoId: string; track: PageBridgeTrack }
  | { requestId: string; action: 'FETCH_NATIVE_TRANSCRIPT'; videoId: string; track: PageBridgeTrack; isOnlyTrack: boolean };

export type PageBridgeSuccess =
  | { requestId: string; action: 'GET_SNAPSHOT'; ok: true; data: { snapshot: unknown } }
  | { requestId: string; action: 'FETCH_TIMEDTEXT'; ok: true; data: { bodies: TimedTextBody[]; networkFailure: boolean } }
  | { requestId: string; action: 'FETCH_TRANSCRIPT_ENDPOINT'; ok: true; data: { body: string } }
  | { requestId: string; action: 'FETCH_NATIVE_TRANSCRIPT'; ok: true; data: { segments: TranscriptSegment[] } };

export type PageBridgeFailure = {
  requestId: string;
  action: PageBridgeAction;
  ok: false;
  error: { code: string; message: string };
};

export type PageBridgeResponse = PageBridgeSuccess | PageBridgeFailure;

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_BODY_LENGTH = 4 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAction(value: unknown): value is PageBridgeAction {
  return value === 'GET_SNAPSHOT'
    || value === 'FETCH_TIMEDTEXT'
    || value === 'FETCH_TRANSCRIPT_ENDPOINT'
    || value === 'FETCH_NATIVE_TRANSCRIPT';
}

export function isPageBridgeRequest(value: unknown): value is PageBridgeRequest {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId) || !isAction(value.action)) return false;
  if (typeof value.videoId !== 'string' || !VIDEO_ID.test(value.videoId)) return false;
  if (value.action === 'FETCH_TIMEDTEXT') return typeof value.baseUrl === 'string' && value.baseUrl.length <= 8_000;
  if (value.action === 'FETCH_TRANSCRIPT_ENDPOINT' || value.action === 'FETCH_NATIVE_TRANSCRIPT') {
    const validTrack = isRecord(value.track)
      && typeof value.track.id === 'string'
      && value.track.id.length > 0
      && value.track.id.length <= 200
      && typeof value.track.languageCode === 'string'
      && /^[A-Za-z0-9-]{2,35}$/.test(value.track.languageCode)
      && typeof value.track.label === 'string'
      && value.track.label.length > 0
      && value.track.label.length <= 200;
    return validTrack && (value.action !== 'FETCH_NATIVE_TRANSCRIPT' || typeof value.isOnlyTrack === 'boolean');
  }
  return value.action === 'GET_SNAPSHOT';
}

function isTranscriptSegments(value: unknown): value is TranscriptSegment[] {
  if (!Array.isArray(value) || value.length > 20_000) return false;
  let totalTextLength = 0;
  for (const segment of value) {
    if (!isRecord(segment)
      || typeof segment.text !== 'string'
      || !segment.text
      || segment.text.length > 10_000
      || typeof segment.startMs !== 'number'
      || !Number.isFinite(segment.startMs)
      || segment.startMs < 0) return false;
    totalTextLength += segment.text.length;
    if (totalTextLength > MAX_BODY_LENGTH) return false;
  }
  return true;
}

function isTimedTextBodies(value: unknown): value is TimedTextBody[] {
  return Array.isArray(value) && value.length <= 3 && value.every((body) => (
    isRecord(body)
    && (body.format === 'json3' || body.format === 'srv3' || body.format === 'xml')
    && typeof body.body === 'string'
    && body.body.length <= MAX_BODY_LENGTH
  )) && value.reduce((size, body) => size + body.body.length, 0) <= MAX_BODY_LENGTH;
}

function isMinimalSnapshot(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || !isRecord(value.videoDetails)) return false;
  if (typeof value.videoDetails.videoId !== 'string' || !VIDEO_ID.test(value.videoDetails.videoId)) return false;
  if (value.videoDetails.title !== undefined && (typeof value.videoDetails.title !== 'string' || value.videoDetails.title.length > 1_000)) return false;
  if (!isRecord(value.captions) || !isRecord(value.captions.playerCaptionsTracklistRenderer)) return false;
  const tracks = value.captions.playerCaptionsTracklistRenderer.captionTracks;
  return Array.isArray(tracks) && tracks.length <= 100 && tracks.every((track) => (
    isRecord(track)
    && typeof track.baseUrl === 'string'
    && track.baseUrl.length <= 8_000
    && typeof track.languageCode === 'string'
    && track.languageCode.length <= 35
  ));
}

/** Validates every message crossing from the page's main world into the extension. */
export function isPageBridgeResponse(
  value: unknown,
  requestId: string,
  action: PageBridgeAction,
): value is PageBridgeResponse {
  if (!isRecord(value) || value.requestId !== requestId || value.action !== action || typeof value.ok !== 'boolean') return false;
  if (!value.ok) {
    return isRecord(value.error)
      && typeof value.error.code === 'string'
      && value.error.code.length <= 80
      && typeof value.error.message === 'string'
      && value.error.message.length <= 300;
  }
  if (!isRecord(value.data)) return false;
  if (action === 'GET_SNAPSHOT') return isMinimalSnapshot(value.data.snapshot);
  if (action === 'FETCH_TIMEDTEXT') return isTimedTextBodies(value.data.bodies) && typeof value.data.networkFailure === 'boolean';
  if (action === 'FETCH_TRANSCRIPT_ENDPOINT') return typeof value.data.body === 'string' && value.data.body.length <= MAX_BODY_LENGTH;
  return isTranscriptSegments(value.data.segments);
}
