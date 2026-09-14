import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJson3Transcript } from '../../src/lib/transcript/parse-json3';
import { parseClassicXmlTranscript, parseSrv3Transcript } from '../../src/lib/transcript/parse-xml';
import { inspectYoutubeiTranscript, parseYoutubeiTranscript } from '../../src/lib/transcript/parse-youtubei';

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'tests', 'fixtures', name), 'utf8');

describe('caption parsers', () => {
  it('parses JSON3 spans, entities, timestamps, and drops only blank captions', () => {
    expect(parseJson3Transcript(fixture('json3-multi-span.json'))).toEqual([
      { startMs: 3200, text: 'Hello & welcome.' },
      { startMs: 67400, text: 'Next point.' },
    ]);
  });

  it('keeps a legitimate repeated caption event', () => {
    const body = JSON.stringify({ events: [
      { tStartMs: 1000, segs: [{ utf8: 'Again' }] },
      { tStartMs: 2000, segs: [{ utf8: 'Again' }] },
    ] });
    expect(parseJson3Transcript(body)).toEqual([
      { startMs: 1000, text: 'Again' },
      { startMs: 2000, text: 'Again' },
    ]);
  });

  it('turns rolling auto-caption snapshots into only their newly appended text', () => {
    expect(parseJson3Transcript(fixture('auto-rolling.json'))).toEqual([
      { startMs: 1000, text: 'Good' },
      { startMs: 1400, text: 'morning' },
      { startMs: 2600, text: 'everyone' },
    ]);
  });

  it('parses srv3 with multiple text spans', () => {
    expect(parseSrv3Transcript(fixture('srv3.xml'))).toEqual([
      { startMs: 3200, text: 'Hello world & friends' },
      { startMs: 67400, text: 'Second line' },
    ]);
  });

  it('parses classic XML second-based starts and entities', () => {
    expect(parseClassicXmlTranscript(fixture('classic.xml'))).toEqual([
      { startMs: 3999, text: 'One & two' },
      { startMs: 60000, text: 'Minute' },
      { startMs: 3600000, text: 'Hour' },
    ]);
  });

  it('parses the live youtubei transcript segment and cue-group variants', () => {
    expect(parseYoutubeiTranscript(fixture('youtubei-transcript.json'))).toEqual([
      { startMs: 7000, text: 'In July of 2025, top athletes competed...' },
      { startMs: 33000, text: 'This might sound a little daunting...' },
    ]);
  });

  it('drops invalid timing, avoids cue-group duplicates, and trims rolling captions', () => {
    const body = JSON.stringify({ items: [
      { transcriptSegmentRenderer: { startMs: '-1', snippet: { simpleText: 'Invalid' } } },
      { transcriptCueGroupRenderer: {
        startOffsetMs: '1000',
        text: { simpleText: 'Metadata duplicate' },
        cues: [{ transcriptCueRenderer: { cue: { simpleText: 'Good' } } }],
      } },
      { transcriptSegmentRenderer: { startMs: '1400', snippet: { simpleText: 'Good morning' } } },
      { transcriptSegmentRenderer: { startMs: '1400', snippet: { simpleText: 'Good morning' } } },
      { transcriptSegmentRenderer: { startMs: '1800', snippet: { simpleText: 'Good morning everyone' } } },
      { transcriptSegmentRenderer: { startMs: 'NaN', snippet: { simpleText: 'Text without timing' } } },
    ] });

    expect(inspectYoutubeiTranscript(body)).toMatchObject({ hasText: true, recognized: true });
    expect(parseYoutubeiTranscript(body)).toEqual([
      { startMs: 1_000, text: 'Good' },
      { startMs: 1_400, text: 'morning' },
      { startMs: 1_800, text: 'everyone' },
    ]);
  });
});
