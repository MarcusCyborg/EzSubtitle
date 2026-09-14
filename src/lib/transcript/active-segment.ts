import type { TranscriptSegment } from '../../types/transcript';

/** Returns the latest segment that has started, or -1 before the first segment. */
export function findActiveSegmentIndex(segments: TranscriptSegment[], currentTimeMs: number): number {
  if (!Number.isFinite(currentTimeMs) || currentTimeMs < 0 || !segments.length) return -1;

  let low = 0;
  let high = segments.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const segment = segments[middle];
    if (segment && segment.startMs <= currentTimeMs) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}
