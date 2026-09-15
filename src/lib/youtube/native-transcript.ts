import type { TranscriptSegment } from '../../types/transcript';
import { normalizeCaptionText } from '../transcript/normalize';
import type { TranscriptTrackSelector } from './transcript-endpoints';

type RecordValue = Record<string, unknown>;

export const NATIVE_TRANSCRIPT_SEGMENT_SELECTOR = 'ytd-transcript-segment-renderer, transcript-segment-view-model';
export const NATIVE_TRANSCRIPT_PANEL_SELECTOR = [
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
  'ytd-engagement-panel-section-list-renderer:has(ytd-transcript-search-panel-renderer)',
  'ytd-engagement-panel-section-list-renderer:has(ytd-search-in-video-renderer)',
  'ytd-engagement-panel-section-list-renderer:has(transcript-segment-view-model)',
].join(',');

export function nativeElementIsHidden(element: HTMLElement, cache = new Map<HTMLElement, boolean>()): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  const hidden = element.hidden || element.getAttribute('aria-hidden') === 'true'
    || element.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'
    || element.ownerDocument.defaultView?.getComputedStyle(element).display === 'none'
    || Boolean(element.parentElement && nativeElementIsHidden(element.parentElement, cache));
  cache.set(element, hidden);
  return hidden;
}

export function nativePanelIsExpanded(panel: HTMLElement | null): panel is HTMLElement {
  return Boolean(panel && !nativeElementIsHidden(panel)
    && (panel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'
      || panel.getAttribute('aria-hidden') === 'false'));
}

export function findNativeTranscriptPanel(root: ParentNode): HTMLElement | null {
  const panels = Array.from(root.querySelectorAll<HTMLElement>(NATIVE_TRANSCRIPT_PANEL_SELECTOR));
  return panels.find(nativePanelIsExpanded) ?? panels[0] ?? null;
}

export function nativeTranscriptTab(root: ParentNode): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('button, [role="tab"], yt-chip-cloud-chip-renderer')).find((element) => (
    !nativeElementIsHidden(element)
    && /^(transcript|show transcript|ban chep loi|hien ban chep loi)$/.test(normalized(element.getAttribute('aria-label') || element.textContent || ''))
  )) ?? null;
}

export function nativeSelectedTab(root: ParentNode): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="tab"], yt-chip-cloud-chip-renderer')).find((element) => (
    element.getAttribute('aria-selected') === 'true' || element.hasAttribute('selected')
  )) ?? null;
}

export type NativeTranscriptMenuEntry = {
  title: string;
  selected: boolean;
};

export type NativeTranscriptInspection = {
  segments: TranscriptSegment[];
  hasText: boolean;
  hasUntimedText: boolean;
  hasTargetIds: boolean;
  trackIdentityValid: boolean;
  trackKey: string | null;
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalized(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return normalizeCaptionText(value);
  if (!isRecord(value)) return '';
  if (typeof value.simpleText === 'string') return normalizeCaptionText(value.simpleText);
  if (!Array.isArray(value.runs)) return '';
  return normalizeCaptionText(value.runs.map((run) => (
    isRecord(run) && typeof run.text === 'string' ? run.text : ''
  )).join(''));
}

function finiteStartMs(value: unknown): number | null {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) && numberValue >= 0 ? Math.floor(numberValue) : null;
}

export function parseNativeTimestamp(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part))) return null;
  const [first = 0, second = 0, third = 0] = numbers;
  const seconds = parts.length === 3
    ? first * 3_600 + second * 60 + third
    : first * 60 + second;
  return seconds * 1_000;
}

/** Only recognize explicit start/end suffixes; arbitrary renderer IDs are not track IDs. */
export function nativeTrackKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const targetId = value.trim();
  if (!targetId || targetId.length > 2_000) return null;
  const match = /^(.*?)[-_:|/](\d+(?:\.\d+)?)[-_:|/](\d+(?:\.\d+)?)$/u.exec(targetId);
  return match?.[1] || null;
}

export function nativeMenuEntries(value: unknown): NativeTranscriptMenuEntry[] {
  if (!Array.isArray(value) || value.length > 100) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.title !== 'string') return [];
    const title = entry.title.trim();
    if (!title || title.length > 200) return [];
    return [{ title, selected: entry.selected === true }];
  });
}

/** Maps the native menu to the player track list without reading opaque continuation tokens. */
export function nativeMenuIndexForTrack(
  entries: NativeTranscriptMenuEntry[],
  playerTracks: TranscriptTrackSelector[],
  requestedTrack: TranscriptTrackSelector,
): number | null {
  const exactTrackIndex = playerTracks.findIndex((track) => track.id === requestedTrack.id);
  if (exactTrackIndex >= 0 && exactTrackIndex < entries.length && entries.length === playerTracks.length) {
    return exactTrackIndex;
  }

  const requestedLanguage = normalized(requestedTrack.languageCode);
  const requestedLabel = normalized(requestedTrack.label);
  const matchingPlayerIndexes = playerTracks.flatMap((track, index) => {
    const sameLanguage = normalized(track.languageCode) === requestedLanguage;
    const sameLabel = normalized(track.label) === requestedLabel;
    return sameLanguage && sameLabel && index < entries.length ? [index] : [];
  });
  if (matchingPlayerIndexes.length === 1) return matchingPlayerIndexes[0] ?? null;

  const matchingLabels = entries.flatMap((entry, index) => (
    normalized(entry.title) === requestedLabel ? [index] : []
  ));
  return matchingLabels.length === 1 ? matchingLabels[0] ?? null : null;
}

export function inspectNativeTranscript(root: ParentNode): NativeTranscriptInspection {
  const segments: TranscriptSegment[] = [];
  let hasText = false;
  let hasUntimedText = false;
  let textRendererCount = 0;
  let targetIdCount = 0;
  const trackKeys = new Set<string>();
  const visibilityCache = new Map<HTMLElement, boolean>();

  for (const element of Array.from(root.querySelectorAll<HTMLElement>(NATIVE_TRANSCRIPT_SEGMENT_SELECTOR))) {
    if (nativeElementIsHidden(element, visibilityCache)) continue;
    const data = isRecord((element as HTMLElement & { data?: unknown }).data)
      ? (element as HTMLElement & { data: RecordValue }).data
      : null;
    const text = textValue(data?.snippet)
      || normalizeCaptionText(element.querySelector<HTMLElement>('.segment-text, .ytAttributedStringHost')?.textContent ?? '');
    if (!text) continue;
    hasText = true;
    textRendererCount += 1;
    const trackKey = nativeTrackKey(data?.targetId);
    if (trackKey) {
      targetIdCount += 1;
      trackKeys.add(trackKey);
    }

    const startMs = finiteStartMs(data?.startMs)
      ?? parseNativeTimestamp(textValue(data?.startTimeText))
      ?? parseNativeTimestamp(element.querySelector<HTMLElement>('.segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp')?.textContent ?? '');
    if (startMs !== null) segments.push({ startMs, text });
    else hasUntimedText = true;
  }

  segments.sort((left, right) => left.startMs - right.startMs);
  const seen = new Set<string>();
  const uniqueSegments = segments.filter((segment) => {
      const key = `${segment.startMs}\u0000${segment.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const hasTargetIds = targetIdCount > 0;
  const trackIdentityValid = !hasTargetIds || (targetIdCount === textRendererCount && trackKeys.size === 1);
  return {
    segments: uniqueSegments,
    hasText,
    hasUntimedText,
    hasTargetIds,
    trackIdentityValid,
    trackKey: trackIdentityValid && trackKeys.size === 1 ? [...trackKeys][0] ?? null : null,
  };
}

export function nativeTranscriptSignature(root: ParentNode): string {
  return nativeInspectionSignature(inspectNativeTranscript(root));
}

export function nativeInspectionSignature(inspection: NativeTranscriptInspection): string {
  return inspection.segments.map((segment) => `${segment.startMs}:${segment.text}`).join('|');
}
