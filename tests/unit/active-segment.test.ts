import { describe, expect, it } from 'vitest';
import { findActiveSegmentIndex } from '../../src/lib/transcript/active-segment';

const segments = [
  { startMs: 7_000, text: 'First' },
  { startMs: 33_000, text: 'Second' },
  { startMs: 57_000, text: 'Third' },
];

describe('active transcript segment', () => {
  it('chooses the segment interval containing the current video time', () => {
    expect(findActiveSegmentIndex(segments, 33_000)).toBe(1);
    expect(findActiveSegmentIndex(segments, 56_999)).toBe(1);
  });

  it('returns no segment before the first caption and retains the last after it starts', () => {
    expect(findActiveSegmentIndex(segments, 6_999)).toBe(-1);
    expect(findActiveSegmentIndex(segments, 200_000)).toBe(2);
  });
});
