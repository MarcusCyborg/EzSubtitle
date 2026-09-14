import { describe, expect, it } from 'vitest';
import { endpointForTrack, inspectTranscriptEndpoints, responseMatchesTrack } from '../../src/lib/youtube/transcript-endpoints';

describe('YouTube transcript endpoint discovery', () => {
  it('walks arrays safely and recognizes endpoint, reload, and continuation-command schemas', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const inspection = inspectTranscriptEndpoints({
      engagementPanels: [cyclic, {
        continuationEndpoint: { getTranscriptEndpoint: { params: 'DEFAULT_ENDPOINT_1234567890' } },
      }],
      languageMenu: { subMenuItems: [
        { title: 'English', languageCode: 'en', selected: true },
        { title: 'Tiếng Việt', languageCode: 'vi', continuation: { reloadContinuationData: { continuation: 'VI_RELOAD_ENDPOINT_1234567' } } },
        {
          title: 'Deutsch', languageCode: 'de', serviceEndpoint: {
            commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/get_transcript' } },
            continuationCommand: { token: 'DE_CONTINUATION_123456789' },
          },
        },
      ] },
    });

    expect(inspection.endpoints.map((endpoint) => endpoint.params)).toEqual(expect.arrayContaining([
      'DEFAULT_ENDPOINT_1234567890', 'VI_RELOAD_ENDPOINT_1234567', 'DE_CONTINUATION_123456789',
    ]));
    expect(responseMatchesTrack(inspection, { id: '.en', languageCode: 'en', label: 'English' })).toBe(true);
    expect(endpointForTrack(inspection, { id: '.vi', languageCode: 'vi', label: 'Tiếng Việt' })?.params).toBe('VI_RELOAD_ENDPOINT_1234567');
  });

  it('rejects malformed params and commands for unrelated APIs', () => {
    const inspection = inspectTranscriptEndpoints({
      commands: [
        { getTranscriptEndpoint: { params: 'short' } },
        {
          title: 'Vietnamese', languageCode: 'vi',
          commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/like' } },
          getTranscriptEndpoint: { params: 'VALID_LOOKING_PARAMS_123456' },
        },
      ],
    });
    expect(inspection.endpoints).toEqual([]);
  });
});
