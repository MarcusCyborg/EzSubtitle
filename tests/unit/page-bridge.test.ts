import { describe, expect, it } from 'vitest';
import { isPageBridgeRequest, isPageBridgeResponse } from '../../src/lib/youtube/page-bridge';

const requestId = '48c6d11a-0c04-4a22-bd7f-d19d297ef949';

describe('main-world bridge validation', () => {
  it('accepts only bounded requests with a current video and structured track selector', () => {
    expect(isPageBridgeRequest({ requestId, action: 'GET_SNAPSHOT', videoId: 'dQw4w9WgXcQ' })).toBe(true);
    expect(isPageBridgeRequest({
      requestId,
      action: 'FETCH_TRANSCRIPT_ENDPOINT',
      videoId: 'dQw4w9WgXcQ',
      track: { id: '.vi', languageCode: 'vi', label: 'Tiếng Việt' },
    })).toBe(true);
    expect(isPageBridgeRequest({ requestId, action: 'FETCH_TRANSCRIPT_ENDPOINT', videoId: 'dQw4w9WgXcQ', track: { languageCode: 'vi' } })).toBe(false);
    expect(isPageBridgeRequest({
      requestId,
      action: 'FETCH_NATIVE_TRANSCRIPT',
      videoId: 'dQw4w9WgXcQ',
      track: { id: '.vi', languageCode: 'vi', label: 'Tiếng Việt' },
      isOnlyTrack: true,
    })).toBe(true);
  });

  it('accepts a bounded, matching page response', () => {
    const response = {
      requestId,
      action: 'FETCH_TIMEDTEXT',
      ok: true,
      data: { bodies: [{ format: 'json3', body: '{"events":[]}' }], networkFailure: false },
    };
    expect(isPageBridgeResponse(response, requestId, 'FETCH_TIMEDTEXT')).toBe(true);
    expect(isPageBridgeResponse({
      requestId,
      action: 'FETCH_NATIVE_TRANSCRIPT',
      ok: true,
      data: { segments: [{ startMs: 6_878, text: 'Timestamped text' }] },
    }, requestId, 'FETCH_NATIVE_TRANSCRIPT')).toBe(true);
  });

  it('rejects forged request ids, actions, and malformed payloads', () => {
    expect(isPageBridgeRequest({ requestId: 'short', action: 'GET_SNAPSHOT' })).toBe(false);
    expect(isPageBridgeResponse({ requestId: 'wrong-request-id-123', action: 'FETCH_TIMEDTEXT', ok: true, data: { bodies: [], networkFailure: false } }, requestId, 'FETCH_TIMEDTEXT')).toBe(false);
    expect(isPageBridgeResponse({ requestId, action: 'FETCH_TIMEDTEXT', ok: true, data: { bodies: [{ format: 'json3', body: 7 }], networkFailure: false } }, requestId, 'FETCH_TIMEDTEXT')).toBe(false);
    expect(isPageBridgeResponse({ requestId, action: 'FETCH_NATIVE_TRANSCRIPT', ok: true, data: { segments: [{ startMs: -1, text: 'Bad' }] } }, requestId, 'FETCH_NATIVE_TRANSCRIPT')).toBe(false);
  });
});
