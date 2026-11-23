import type { CaptionTrack, TranscriptSegment } from '../../types/transcript';
import { isTrustedCaptionUrl } from '../youtube/caption-tracks';
import { TranscriptFetchError } from './errors';
import { inspectJson3Transcript, type ParsedTranscript } from './parse-json3';
import { inspectClassicXmlTranscript, inspectSrv3Transcript } from './parse-xml';
import { fetchBoundedText } from './bounded-response';

export { TranscriptFetchError } from './errors';

export type TimedTextFormat = 'json3' | 'srv3' | 'xml';

export type TimedTextBody = {
  format: TimedTextFormat;
  body: string;
};

type Fetcher = typeof fetch;

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
  signal = AbortSignal.timeout(8_000),
): Promise<TranscriptSegment[]> {
  if (!isTrustedCaptionUrl(track.baseUrl)) {
    throw new TranscriptFetchError('INVALID_CAPTION_URL');
  }

  // The MV3 worker has no DOMParser. XML belongs to the page fallback.
  const format = 'json3';
  let response: Awaited<ReturnType<typeof fetchBoundedText>>;
  try {
    response = await fetchBoundedText(transport, captionUrlWithFormat(track.baseUrl, format), {}, signal);
  } catch (error) {
    if (error instanceof Error && error.message === 'RESPONSE_TOO_LARGE') {
      throw new TranscriptFetchError('UNPARSEABLE_RESPONSE');
    }
    throw new TranscriptFetchError('NETWORK_ERROR');
  }
  if (!response.ok) throw new TranscriptFetchError('CAPTION_UNAVAILABLE');
  return transcriptFromTimedTextBodies([{ format, body: response.body }]);
}
