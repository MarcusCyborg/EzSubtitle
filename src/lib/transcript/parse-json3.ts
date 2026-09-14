import type { TranscriptSegment } from '../../types/transcript';
import { isTimestamp, normalizeCaptionText } from './normalize';

type Json3Event = {
  tStartMs?: unknown;
  segs?: Array<{ utf8?: unknown }>;
  wWinId?: unknown;
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
  if (!Array.isArray(parsed.events)) return { segments: [], hasText: false, recognized: false };

  const latestByWindow = new Map<number, string>();
  const segments: TranscriptSegment[] = [];
  let hasText = false;
  for (const value of parsed.events) {
    if (!value || typeof value !== 'object') continue;
    const event = value as Json3Event;
    if (!Array.isArray(event.segs)) continue;
    const rawText = event.segs.map((span) => typeof span.utf8 === 'string' ? span.utf8 : '').join('');
    let text = normalizeCaptionText(rawText);
    if (!text) continue;
    hasText = true;
    if (!isTimestamp(event.tStartMs)) continue;

    if (typeof event.wWinId === 'number' && Number.isFinite(event.wWinId)) {
      const delta = rollingDelta(text, latestByWindow.get(event.wWinId));
      latestByWindow.set(event.wWinId, text);
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
