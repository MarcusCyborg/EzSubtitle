import type { TranscriptSegment } from '../../types/transcript';
import { normalizeCaptionText } from './normalize';
import type { ParsedTranscript } from './parse-json3';

function parseXml(body: string): Document | null {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(body, 'text/xml');
  return document.querySelector('parsererror') ? null : document;
}

function finiteStart(value: string | null, multiplier: number): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric * multiplier);
}

export function inspectSrv3Transcript(body: string): ParsedTranscript {
  const document = parseXml(body);
  if (!document) return { segments: [], hasText: false, recognized: false };
  const nodes = Array.from(document.querySelectorAll('p'));
  const segments = nodes.flatMap((node) => {
    const startMs = finiteStart(node.getAttribute('t'), 1);
    const text = normalizeCaptionText(node.textContent ?? '');
    return startMs === null || !text ? [] : [{ startMs, text }];
  });
  return {
    segments,
    hasText: nodes.some((node) => Boolean(normalizeCaptionText(node.textContent ?? ''))),
    recognized: nodes.length > 0,
  };
}

export function parseSrv3Transcript(body: string): TranscriptSegment[] {
  return inspectSrv3Transcript(body).segments;
}

export function inspectClassicXmlTranscript(body: string): ParsedTranscript {
  const document = parseXml(body);
  if (!document) return { segments: [], hasText: false, recognized: false };
  const nodes = Array.from(document.querySelectorAll('text'));
  const segments = nodes.flatMap((node) => {
    const startMs = finiteStart(node.getAttribute('start'), 1000);
    const text = normalizeCaptionText(node.textContent ?? '');
    return startMs === null || !text ? [] : [{ startMs, text }];
  });
  return {
    segments,
    hasText: nodes.some((node) => Boolean(normalizeCaptionText(node.textContent ?? ''))),
    recognized: nodes.length > 0,
  };
}

export function parseClassicXmlTranscript(body: string): TranscriptSegment[] {
  return inspectClassicXmlTranscript(body).segments;
}
