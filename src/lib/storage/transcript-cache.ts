import type { CaptionTrack, TranscriptSegment } from '../../types/transcript';

type CacheRecord = {
  schema: number;
  videoId: string;
  trackId: string;
  languageCode: string;
  baseUrl: string;
  segments: TranscriptSegment[];
  savedAt: number;
};

export const TRANSCRIPT_CACHE_SCHEMA = 2;

function identityHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function cacheKey(videoId: string, track: CaptionTrack): string {
  const identity = `${track.id}\u0000${track.languageCode}\u0000${track.baseUrl}`;
  return `transcript:v${TRANSCRIPT_CACHE_SCHEMA}:${videoId}:${identityHash(identity)}`;
}

function validSegments(value: unknown): value is TranscriptSegment[] {
  return Array.isArray(value) && value.length > 0 && value.every((segment) => (
    Boolean(segment)
    && typeof segment === 'object'
    && typeof (segment as TranscriptSegment).text === 'string'
    && Boolean((segment as TranscriptSegment).text.trim())
    && typeof (segment as TranscriptSegment).startMs === 'number'
    && Number.isFinite((segment as TranscriptSegment).startMs)
    && (segment as TranscriptSegment).startMs >= 0
  ));
}

export async function getCachedTranscript(videoId: string, track: CaptionTrack): Promise<TranscriptSegment[] | null> {
  const key = cacheKey(videoId, track);
  const result = await chrome.storage.session.get(key);
  const record = result[key] as CacheRecord | undefined;
  if (record?.schema !== TRANSCRIPT_CACHE_SCHEMA
    || record.videoId !== videoId
    || record.trackId !== track.id
    || record.languageCode !== track.languageCode
    || record.baseUrl !== track.baseUrl
    || !validSegments(record.segments)) return null;
  return record.segments;
}

export async function cacheTranscript(videoId: string, track: CaptionTrack, segments: TranscriptSegment[]): Promise<void> {
  if (!validSegments(segments)) return;
  await chrome.storage.session.set({
    [cacheKey(videoId, track)]: {
      schema: TRANSCRIPT_CACHE_SCHEMA,
      videoId,
      trackId: track.id,
      languageCode: track.languageCode,
      baseUrl: track.baseUrl,
      segments,
      savedAt: Date.now(),
    } satisfies CacheRecord,
  });
}
