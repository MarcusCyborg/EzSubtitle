import { describe, expect, it } from 'vitest';
import {
  formatReadableTranscript,
  formatTimestamp,
  formatTranscript,
  groupReadableTranscript,
} from '../../src/lib/transcript/format';

describe('transcript formatter', () => {
  it.each([
    [0, '00:00:00'],
    [3999, '00:00:03'],
    [59000, '00:00:59'],
    [60000, '00:01:00'],
    [3599000, '00:59:59'],
    [3600000, '01:00:00'],
  ])('formats %i milliseconds as %s', (milliseconds, expected) => {
    expect(formatTimestamp(milliseconds)).toBe(expected);
  });

  it('emits only timestamp and text without a leading newline or metadata', () => {
    const output = formatTranscript([{ startMs: 3200, text: 'Hello.' }, { startMs: 67400, text: 'Next point.' }]);
    expect(output).toBe('[00:00:03] Hello.\n[00:01:07] Next point.');
    expect(output).not.toContain('https://');
    expect(output).not.toContain('Tóm tắt');
  });

  it('groups short segments in order and prefers a sentence boundary after the minimum duration', () => {
    const blocks = groupReadableTranscript([
      { startMs: 6_000, text: 'First short' },
      { startMs: 12_000, text: 'sentence.' },
      { startMs: 20_000, text: 'A new idea' },
      { startMs: 26_000, text: 'continues!' },
    ]);

    expect(blocks).toEqual([
      { startMs: 6_000, text: 'First short sentence.' },
      { startMs: 20_000, text: 'A new idea continues!' },
    ]);
  });

  it('starts a new block at the hard duration and at a large gap', () => {
    expect(groupReadableTranscript([
      { startMs: 0, text: 'A' },
      { startMs: 8_000, text: 'B' },
      { startMs: 16_000, text: 'C' },
      { startMs: 24_000, text: 'D' },
      { startMs: 31_000, text: 'E' },
    ])).toEqual([
      { startMs: 0, text: 'A B C D' },
      { startMs: 31_000, text: 'E' },
    ]);
    expect(groupReadableTranscript([
      { startMs: 0, text: 'Before gap' },
      { startMs: 9_000, text: 'After gap' },
    ])).toEqual([
      { startMs: 0, text: 'Before gap' },
      { startMs: 9_000, text: 'After gap' },
    ]);
    expect(groupReadableTranscript([
      { startMs: 0, text: 'Sentence before silence.' },
      { startMs: 5_000, text: 'After silence' },
    ])).toEqual([
      { startMs: 0, text: 'Sentence before silence.' },
      { startMs: 5_000, text: 'After silence' },
    ]);
  });

  it('normalizes whitespace without re-decoding literal entities in parsed segment text', () => {
    const segments = [
      { startMs: 0, text: 'Xin\n chào &lt;' },
      { startMs: 4_000, text: 'thế giới…' },
      { startMs: 13_000, text: '“Một câu thông minh？”' },
    ];
    const blocks = groupReadableTranscript(segments);
    const inputWords = segments.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim();
    const outputWords = blocks.map((block) => block.text).join(' ').replace(/\s+/g, ' ').trim();

    expect(blocks[0]?.startMs).toBe(0);
    expect(outputWords).toBe(inputWords);
    expect(outputWords).toContain('&lt;');
  });

  it('exports every cue in a long lesson and keeps absolute timestamps and repeated speech', () => {
    const segments = Array.from({ length: 2_400 }, (_, index) => ({
      startMs: index * 4_000,
      text: index % 2 === 0 ? '>> Xin chào 日本語。' : '>> Xin chào lần nữa.',
    }));
    const words = segments.map(({ text }) => text).join(' ');
    const detailed = formatTranscript(segments, 'detailed');
    const readable = formatTranscript(segments, 'readable');
    expect(detailed.split('\n')).toEqual(segments.map(({ startMs, text }) => `[${formatTimestamp(startMs)}] ${text}`));
    expect(readable.replace(/^\(\d+:\d+:[\d]+\) /gm, '').replace(/\s+/g, ' ')).toBe(words);
    expect(readable.split('\n\n').map((block) => block.slice(0, 10)))
      .toEqual(groupReadableTranscript(segments).map(({ startMs }) => `(${formatTimestamp(startMs)})`));
  });

  it('uses compact timestamps below one hour and full timestamps for long videos', () => {
    expect(formatReadableTranscript([{ startMs: 6_878, text: 'Short video.' }])).toBe('(00:06) Short video.');
    expect(formatReadableTranscript([
      { startMs: 6_878, text: 'Opening.' },
      { startMs: 3_723_000, text: 'Later.' },
    ])).toBe('(00:00:06) Opening.\n\n(01:02:03) Later.');
  });

  it('returns empty output for empty input and preserves one very long segment intact', () => {
    const longText = 'word '.repeat(150).trim();
    expect(formatReadableTranscript([])).toBe('');
    expect(groupReadableTranscript([{ startMs: 5_000, text: longText }])).toEqual([{ startMs: 5_000, text: longText }]);
  });
});
