import type { TranscriptOutputMode, TranscriptSegment } from '../../types/transcript';
import { normalizeCaptionText } from './normalize';

const READABLE_MIN_DURATION_MS = 12_000;
const READABLE_MAX_DURATION_MS = 30_000;
const READABLE_MAX_CHARACTERS = 500;
const READABLE_SOFT_GAP_MS = 4_500;
const READABLE_HARD_GAP_MS = 8_000;
const SENTENCE_END = /[.!?\u3002\uff01\uff1f\u2026](?:["'\u2019\u201d\u00bb)\]}]+)?$/u;

export function formatTimestamp(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export function formatDetailedTranscript(segments: TranscriptSegment[]): string {
  return segments.map((segment) => `[${formatTimestamp(segment.startMs)}] ${segment.text}`).join('\n');
}

export function groupReadableTranscript(segments: TranscriptSegment[]): TranscriptSegment[] {
  const blocks: TranscriptSegment[] = [];
  let block: TranscriptSegment | null = null;
  let previousStartMs: number | null = null;

  const flush = () => {
    if (block) blocks.push(block);
    block = null;
  };

  for (const segment of segments) {
    const text = normalizeCaptionText(segment.text);
    if (!text) continue;
    if (!block) {
      block = { startMs: segment.startMs, text };
      previousStartMs = segment.startMs;
      continue;
    }

    const gapMs = previousStartMs === null ? 0 : segment.startMs - previousStartMs;
    const projectedDurationMs = segment.startMs - block.startMs;
    const projectedLength = block.text.length + 1 + text.length;
    const preferredBreak = projectedDurationMs >= READABLE_MIN_DURATION_MS && SENTENCE_END.test(block.text);
    const silenceBreak = gapMs > READABLE_HARD_GAP_MS
      || (gapMs > READABLE_SOFT_GAP_MS && SENTENCE_END.test(block.text));
    if (preferredBreak
      || silenceBreak
      || projectedDurationMs > READABLE_MAX_DURATION_MS
      || projectedLength > READABLE_MAX_CHARACTERS) {
      flush();
      block = { startMs: segment.startMs, text };
    } else {
      block.text = `${block.text} ${text}`;
    }
    previousStartMs = segment.startMs;

    if (segment.startMs - block.startMs >= READABLE_MIN_DURATION_MS && SENTENCE_END.test(block.text)) flush();
  }
  flush();
  return blocks;
}

export function formatReadableTimestamp(startMs: number, showHours: boolean): string {
  const full = formatTimestamp(startMs);
  return showHours ? full : full.slice(3);
}

export function formatReadableTranscript(segments: TranscriptSegment[]): string {
  const blocks = groupReadableTranscript(segments);
  const showHours = segments.some((segment) => segment.startMs >= 3_600_000);
  return blocks.map((block) => `(${formatReadableTimestamp(block.startMs, showHours)}) ${block.text}`).join('\n\n');
}

export function formatTranscript(
  segments: TranscriptSegment[],
  mode: TranscriptOutputMode = 'detailed',
): string {
  return mode === 'readable' ? formatReadableTranscript(segments) : formatDetailedTranscript(segments);
}

function safeFilenamePart(value: string, fallback: string): string {
  const ascii = value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.slice(0, 80) || fallback;
}

export function subtitleFilename(videoTitle: string, languageCode: string): string {
  const title = safeFilenamePart(videoTitle, 'youtube-transcript');
  const language = languageCode.replace(/[^A-Za-z0-9_-]/g, '_') || 'unknown';
  return `ezsubtitle-${title}-${language}.txt`;
}
