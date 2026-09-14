import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findNativeTranscriptPanel,
  inspectNativeTranscript,
  nativeMenuIndexForTrack,
  nativeTrackKey,
  parseNativeTimestamp,
} from '../../src/lib/youtube/native-transcript';

describe('native YouTube transcript helpers', () => {
  it('reads timeline-view text and timestamps without copying the accessibility time labels', () => {
    const root = document.createElement('div');
    root.innerHTML = readFileSync(resolve('tests/fixtures/native-timeline.html'), 'utf8');
    const panel = findNativeTranscriptPanel(root);
    expect(panel).not.toBeNull();
    const inspection = inspectNativeTranscript(panel!);
    expect(inspection.segments).toEqual([
      { startMs: 7_000, text: 'everyone. And what I want to explain [music] to you today,' },
      { startMs: 15_000, text: 'supply chains, I now recognize and I have a framework to' },
    ]);
    expect(inspection.hasUntimedText).toBe(false);
    root.querySelector('.transcript-content')?.setAttribute('hidden', '');
    expect(inspectNativeTranscript(panel!).segments).toEqual([]);
  });

  it('prefers an expanded timeline panel over a leftover collapsed legacy panel', () => {
    const root = document.createElement('div');
    root.innerHTML = '<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"></ytd-engagement-panel-section-list-renderer>'
      + readFileSync(resolve('tests/fixtures/native-timeline.html'), 'utf8');
    expect(findNativeTranscriptPanel(root)?.getAttribute('target-id')).toBe('engagement-panel-search-in-video');
  });

  it('reads structured startMs and only falls back to a displayed real timestamp', () => {
    const root = document.createElement('div');
    const exact = document.createElement('ytd-transcript-segment-renderer') as HTMLElement & { data?: unknown };
    exact.data = { startMs: '6878', snippet: { runs: [{ text: 'Exact offset' }] } };
    const displayed = document.createElement('ytd-transcript-segment-renderer');
    displayed.innerHTML = '<span class="segment-timestamp">1:02:03</span><span class="segment-text">Displayed timestamp</span>';
    const untimed = document.createElement('ytd-transcript-segment-renderer') as HTMLElement & { data?: unknown };
    untimed.data = { snippet: { simpleText: 'Text without time' } };
    root.append(exact, displayed, untimed);

    expect(inspectNativeTranscript(root)).toMatchObject({
      hasText: true,
      hasUntimedText: true,
      segments: [
        { startMs: 6_878, text: 'Exact offset' },
        { startMs: 3_723_000, text: 'Displayed timestamp' },
      ],
    });
    expect(parseNativeTimestamp('not a time')).toBeNull();
  });

  it('derives an opaque stable track key and rejects mixed renderer identities', () => {
    expect(nativeTrackKey('opaque-track-en:6878:12000')).toBe('opaque-track-en');
    expect(nativeTrackKey('opaque-track-vi-6878-12000')).toBe('opaque-track-vi');

    const root = document.createElement('div');
    for (const [targetId, text] of [['track-en:0:1000', 'Hello'], ['track-vi:1000:2000', 'Xin chào']]) {
      const segment = document.createElement('ytd-transcript-segment-renderer') as HTMLElement & { data?: unknown };
      segment.data = { targetId, startMs: text === 'Hello' ? '0' : '1000', snippet: { simpleText: text } };
      root.append(segment);
    }

    expect(inspectNativeTranscript(root)).toMatchObject({
      hasTargetIds: true,
      trackIdentityValid: false,
      trackKey: null,
    });
  });

  it('does not interpret arbitrary per-segment IDs as different caption tracks', () => {
    const root = document.createElement('div');
    for (const [index, targetId] of ['transcript-segment-0', 'transcript-segment-1', 'opaqueSegmentAbCd'].entries()) {
      const segment = document.createElement('ytd-transcript-segment-renderer') as HTMLElement & { data?: unknown };
      segment.data = { targetId, startMs: index * 1_000, snippet: { simpleText: `Line ${index}` } };
      root.append(segment);
      expect(nativeTrackKey(targetId)).toBeNull();
    }
    expect(inspectNativeTranscript(root)).toMatchObject({
      trackIdentityValid: true, hasTargetIds: false, trackKey: null,
      segments: [{ startMs: 0 }, { startMs: 1_000 }, { startMs: 2_000 }],
    });
  });

  it('maps duplicate labels by the matching player track id and array position', () => {
    const entries = [
      { title: 'English', selected: true },
      { title: 'English', selected: false },
      { title: 'Tiếng Việt', selected: false },
    ];
    const tracks = [
      { id: '.en', languageCode: 'en', label: 'English' },
      { id: 'a.en', languageCode: 'en', label: 'English' },
      { id: '.vi', languageCode: 'vi', label: 'Tiếng Việt' },
    ];

    expect(nativeMenuIndexForTrack(entries, tracks, tracks[1]!)).toBe(1);
    expect(nativeMenuIndexForTrack(entries, tracks, tracks[2]!)).toBe(2);
  });
});
