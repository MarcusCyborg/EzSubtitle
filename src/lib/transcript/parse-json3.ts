import type { TranscriptSegment } from '../../types/transcript';
import { isTimestamp, normalizeCaptionText } from './normalize';

type Json3Event = {
  tStartMs?: unknown;
  segs?: Array<{ utf8?: unknown }>;
  wWinId?: unknown;
  id?: unknown;
  dDurationMs?: unknown;
};

type Json3Transcript = { events?: unknown };

export type ParsedTranscript = {
  segments: TranscriptSegment[];
  hasText: boolean;
  recognized: boolean;
};

function rollingDelta(text: string, prior: string | undefined): string | null {
  if (!prior) return text;
  if (text === prior || prior.endsWith(text)) return null;
  // Rolling snapshots can grow without a word separator, as in Japanese.
  if (text.startsWith(prior)) return normalizeCaptionText(text.slice(prior.length));
  return text;
}

export function inspectJson3Transcript(body: string): ParsedTranscript {
  let parsed: Json3Transcript;
  try {
    parsed = JSON.parse(body) as Json3Transcript;
  } catch {
    return { segments: [], hasText: false, recognized: false };
  }
  if (!Array.isArray(parsed?.events)) return { segments: [], hasText: false, recognized: false };

  const latestByWindow = new Map<number, { text: string; endMs: number | null }>();
  const segments: TranscriptSegment[] = [];
  let hasText = false;
  for (const value of parsed.events) {
    if (!value || typeof value !== 'object') continue;
    const event = value as Json3Event;
    const windowId = typeof event.wWinId === 'number' ? event.wWinId : null;
    if (!Array.isArray(event.segs)) {
      if (typeof event.id === 'number') latestByWindow.delete(event.id);
      if (windowId !== null) latestByWindow.delete(windowId);
      continue;
    }
    const rawText = event.segs.map((span) => typeof span?.utf8 === 'string' ? span.utf8 : '').join('');
    let text = normalizeCaptionText(rawText);
    if (!text) {
      if (windowId !== null) latestByWindow.delete(windowId);
      continue;
    }
    hasText = true;
    if (!isTimestamp(event.tStartMs)) continue;

    if (windowId !== null && Number.isFinite(windowId)) {
      const prior = latestByWindow.get(windowId);
      const delta = rollingDelta(text, prior && (prior.endMs === null || event.tStartMs < prior.endMs) ? prior.text : undefined);
      const endMs = isTimestamp(event.dDurationMs) && event.dDurationMs > 0 ? event.tStartMs + event.dDurationMs : null;
      latestByWindow.set(windowId, { text, endMs });
      if (!delta) continue;
      text = delta;
    }
    segments.push({ text, startMs: Math.floor(event.tStartMs) });
  }
  return { segments, hasText, recognized: true };
}

export function parseJson3Transcript(body: string): TranscriptSegment[] {
  return inspectJson3Transcript(body).segments;
}
