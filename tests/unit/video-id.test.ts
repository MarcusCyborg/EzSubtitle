import { describe, expect, it } from 'vitest';
import { parseVideoId } from '../../src/lib/youtube/video-id';

describe('parseVideoId', () => {
  it('parses watch, short-link, and Shorts URLs', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ?t=1')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects unrelated and malformed values', () => {
    expect(parseVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoId('https://youtube.com/watch?v=too-short')).toBeNull();
  });
});
