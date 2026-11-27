import type { CaptionTrack, TranscriptSegment } from '../../types/transcript';
import type { TranscriptProvenance } from '../../types/messages';
import { captionTrackIdentity, captionTranslation } from '../youtube/caption-tracks';

type CachedTranscript = { segments: TranscriptSegment[]; provenance: TranscriptProvenance };
type CacheRecord = {
  schema: number;
  identity: string;
} & CachedTranscript;

export const TRANSCRIPT_CACHE_SCHEMA = 4;
export const TRANSCRIPT_CACHE_TTL_MS = 30 * 60 * 1000;

function identityHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function cacheKey(videoId: string, track: CaptionTrack, tabId: number): string {
  return `transcript:v${TRANSCRIPT_CACHE_SCHEMA}:${tabId}:${videoId}:${identityHash(captionTrackIdentity(track))}`;
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

function cacheable(provenance: TranscriptProvenance | undefined): boolean {
  return provenance?.source === 'background-timedtext' || provenance?.source === 'page-timedtext';
}

export async function getCachedTranscript(videoId: string, track: CaptionTrack, tabId: number): Promise<CachedTranscript | null> {
  const key = cacheKey(videoId, track, tabId);
  const result = await chrome.storage.session.get(key);
  const record = result[key] as CacheRecord | undefined;
  const provenance = record?.provenance;
  const age = Date.now() - (provenance?.fetchedAt ?? Number.NaN);
  if (record?.schema !== TRANSCRIPT_CACHE_SCHEMA
    || record.identity !== captionTrackIdentity(track)
    || !provenance || !cacheable(provenance)
    || provenance.videoId !== videoId
    || provenance.trackId !== track.id
    || provenance.languageCode !== track.languageCode
    || provenance.translation !== captionTranslation(track)
    || !Number.isFinite(age) || age < 0 || age >= TRANSCRIPT_CACHE_TTL_MS
    || !validSegments(record.segments)) return null;
  return { segments: record.segments, provenance: { ...provenance, cacheHit: true } };
}

export async function cacheTranscript(track: CaptionTrack, tabId: number, { segments, provenance }: CachedTranscript): Promise<void> {
  if (!cacheable(provenance) || !validSegments(segments)) return;
  await chrome.storage.session.set({
    [cacheKey(provenance.videoId, track, tabId)]: {
      schema: TRANSCRIPT_CACHE_SCHEMA,
      identity: captionTrackIdentity(track),
      segments,
      provenance,
    } satisfies CacheRecord,
  });
}
