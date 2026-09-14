import type { TranscriptSegment } from '../../types/transcript';
import { normalizeCaptionText } from './normalize';
import type { ParsedTranscript } from './parse-json3';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteStart(value: unknown): number | null {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) && numberValue >= 0 ? Math.floor(numberValue) : null;
}

function textFromRuns(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.simpleText === 'string') return normalizeCaptionText(value.simpleText);
  if (!Array.isArray(value.runs)) return '';
  return normalizeCaptionText(value.runs.map((run) => (
    isRecord(run) && typeof run.text === 'string' ? run.text : ''
  )).join(''));
}

function rendererText(renderer: UnknownRecord): string {
  for (const key of ['snippet', 'cue', 'text', 'transcript', 'content']) {
    const text = textFromRuns(renderer[key]);
    if (text) return text;
  }
  return '';
}

function containsChildRenderer(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (Array.isArray(value)) return value.some((child) => containsChildRenderer(child, depth + 1));
  if (!isRecord(value)) return false;
  if (isRecord(value.transcriptSegmentRenderer) || isRecord(value.transcriptCueRenderer)) return true;
  return Object.values(value).some((child) => containsChildRenderer(child, depth + 1));
}

function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  segments.sort((left, right) => left.startMs - right.startMs);
  const result: TranscriptSegment[] = [];
  const exact = new Set<string>();
  let priorRaw: TranscriptSegment | null = null;
  for (const segment of segments) {
    const key = `${segment.startMs}\u0000${segment.text}`;
    if (exact.has(key)) continue;
    exact.add(key);
    if (priorRaw && segment.startMs - priorRaw.startMs <= 10_000 && segment.text.startsWith(priorRaw.text)) {
      const delta = normalizeCaptionText(segment.text.slice(priorRaw.text.length));
      priorRaw = segment;
      if (!delta) continue;
      result.push({ startMs: segment.startMs, text: delta });
    } else {
      result.push(segment);
      priorRaw = segment;
    }
  }
  return result;
}

function rendererStart(renderer: UnknownRecord, inheritedStart: number | null = null): number | null {
  for (const key of ['startMs', 'startOffsetMs', 'startTimeMs']) {
    const start = finiteStart(renderer[key]);
    if (start !== null) return start;
  }
  return inheritedStart;
}

function addRendererSegment(
  renderer: unknown,
  segments: TranscriptSegment[],
  observed: { hasText: boolean },
  inheritedStart: number | null = null,
): void {
  if (!isRecord(renderer)) return;
  const text = rendererText(renderer);
  if (!text) return;
  observed.hasText = true;
  const startMs = rendererStart(renderer, inheritedStart);
  if (startMs !== null) segments.push({ startMs, text });
}

/**
 * The current endpoint normally uses transcriptSegmentRenderer. Older rollout
 * variants group transcriptCueRenderer entries under transcriptCueGroupRenderer,
 * so both are walked without relying on display-only timestamp text.
 */
export function inspectYoutubeiTranscript(body: string): ParsedTranscript {
  let root: unknown;
  try {
    root = JSON.parse(body) as unknown;
  } catch {
    return { segments: [], hasText: false, recognized: false };
  }

  const segments: TranscriptSegment[] = [];
  const observed = { hasText: false, recognized: false };
  const seen = new WeakSet<object>();

  const walk = (value: unknown, inheritedStart: number | null = null): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, inheritedStart);
      return;
    }
    if (!isRecord(value) || seen.has(value)) return;
    seen.add(value);

    const segmentRenderer = value.transcriptSegmentRenderer;
    if (isRecord(segmentRenderer)) {
      observed.recognized = true;
      addRendererSegment(segmentRenderer, segments, observed, inheritedStart);
      return;
    }

    const cueRenderer = value.transcriptCueRenderer;
    if (isRecord(cueRenderer)) {
      observed.recognized = true;
      addRendererSegment(cueRenderer, segments, observed, inheritedStart);
      return;
    }

    const cueGroupRenderer = value.transcriptCueGroupRenderer;
    if (isRecord(cueGroupRenderer)) {
      observed.recognized = true;
      const groupStart = rendererStart(cueGroupRenderer, inheritedStart);
      if (!containsChildRenderer(cueGroupRenderer)) addRendererSegment(cueGroupRenderer, segments, observed, groupStart);
      for (const child of Object.values(cueGroupRenderer)) walk(child, groupStart);
      return;
    }

    for (const child of Object.values(value)) walk(child, inheritedStart);
  };

  walk(root);
  return { segments: normalizeSegments(segments), hasText: observed.hasText, recognized: observed.recognized };
}

export function parseYoutubeiTranscript(body: string): TranscriptSegment[] {
  return inspectYoutubeiTranscript(body).segments;
}
