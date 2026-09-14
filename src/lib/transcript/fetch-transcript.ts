import type { CaptionTrack, TranscriptSegment } from '../../types/transcript';
import { isTrustedCaptionUrl } from '../youtube/caption-tracks';
import { TranscriptFetchError } from './errors';
import { inspectJson3Transcript, type ParsedTranscript } from './parse-json3';
import { inspectClassicXmlTranscript, inspectSrv3Transcript } from './parse-xml';

export { TranscriptFetchError } from './errors';

export type TimedTextFormat = 'json3' | 'srv3' | 'xml';

export type TimedTextBody = {
  format: TimedTextFormat;
  body: string;
};

type Fetcher = typeof fetch;

const strategies: readonly TimedTextFormat[] = ['json3', 'srv3', 'xml'];

export function captionUrlWithFormat(baseUrl: string, format: TimedTextFormat): string {
  const url = new URL(baseUrl);
  if (format === 'xml') url.searchParams.delete('fmt');
  else url.searchParams.set('fmt', format);
  return url.toString();
}

function inspectBody({ format, body }: TimedTextBody): ParsedTranscript {
  switch (format) {
    case 'json3': return inspectJson3Transcript(body);
    case 'srv3': return inspectSrv3Transcript(body);
    case 'xml': return inspectClassicXmlTranscript(body);
  }
}

/** Preserves the useful failure cause instead of equating every empty parse to missing timestamps. */
export function transcriptFromTimedTextBodies(bodies: TimedTextBody[]): TranscriptSegment[] {
  let sawNonEmptyBody = false;
  let sawTranscriptTextWithoutTimestamp = false;
  let sawRecognizedBody = false;

  for (const body of bodies) {
    if (body.body.trim()) sawNonEmptyBody = true;
    const parsed = inspectBody(body);
    if (parsed.recognized) sawRecognizedBody = true;
    if (parsed.segments.length) return parsed.segments;
    if (parsed.hasText) sawTranscriptTextWithoutTimestamp = true;
  }

  if (!sawNonEmptyBody) throw new TranscriptFetchError('EMPTY_RESPONSE');
  if (sawTranscriptTextWithoutTimestamp) throw new TranscriptFetchError('MISSING_TIMESTAMP');
  if (sawRecognizedBody) throw new TranscriptFetchError('CAPTION_UNAVAILABLE');
  throw new TranscriptFetchError('UNPARSEABLE_RESPONSE');
}

export async function fetchTranscriptForTrack(
  track: CaptionTrack,
  transport: Fetcher = fetch,
): Promise<TranscriptSegment[]> {
  if (!isTrustedCaptionUrl(track.baseUrl)) {
    throw new TranscriptFetchError('INVALID_CAPTION_URL');
  }

  const bodies: TimedTextBody[] = [];
  let sawNetworkFailure = false;
  for (const format of strategies) {
    try {
      const response = await transport(captionUrlWithFormat(track.baseUrl, format), { credentials: 'include' });
      if (!response.ok) continue;
      const body = { format, body: await response.text() } satisfies TimedTextBody;
      bodies.push(body);
      try {
        return transcriptFromTimedTextBodies([body]);
      } catch (error) {
        if (!(error instanceof TranscriptFetchError)) throw error;
      }
    } catch {
      sawNetworkFailure = true;
    }
  }

  if (!bodies.length && sawNetworkFailure) throw new TranscriptFetchError('NETWORK_ERROR');
  if (!bodies.length) throw new TranscriptFetchError('CAPTION_UNAVAILABLE');
  return transcriptFromTimedTextBodies(bodies);
}
