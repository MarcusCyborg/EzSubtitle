import type { TranscriptResult, TranscriptSource } from '../../types/messages';
import type { CaptionTrack, TranscriptSegment } from '../../types/transcript';
import { captionTranslation } from '../youtube/caption-tracks';
import { formatTranscript } from './format';

export function transcriptResult(
  segments: TranscriptSegment[], videoId: string, track: CaptionTrack, source: TranscriptSource,
  fallbackErrors: string[] = [],
): TranscriptResult {
  return {
    segments,
    text: formatTranscript(segments),
    provenance: {
      source, videoId, trackId: track.id, languageCode: track.languageCode,
      translation: captionTranslation(track), fetchedAt: Date.now(), cacheHit: false, fallbackErrors,
    },
  };
}

const labels: Record<TranscriptSource, string> = {
  'player-timedtext': 'CC player',
  'background-timedtext': 'Track phụ đề (extension)',
  'page-timedtext': 'Track phụ đề (trang YouTube)',
  youtubei: 'Bản chép lời YouTube (API)',
  'native-dom': 'Bản chép lời YouTube (giao diện)',
};

export function transcriptSourceLabel({ provenance }: TranscriptResult): string {
  return `Nguồn: ${labels[provenance.source]}${provenance.cacheHit ? ' · Đã lưu tạm' : ''}`;
}
