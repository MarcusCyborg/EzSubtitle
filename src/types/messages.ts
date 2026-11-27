import type { CaptionTrack, TranscriptSegment, VideoContext } from './transcript';

export type RuntimeRequest =
  | { type: 'FETCH_TRANSCRIPT'; videoId: string; track: CaptionTrack; trackCount?: number; tabId?: number; bypassCache?: boolean }
  | { type: 'PREPARE_CHATGPT_DRAFT'; transcript: string }
  | { type: 'CLAIM_CHATGPT_DRAFT' }
  | { type: 'MARK_CHATGPT_DRAFT_FILLED'; token: string }
  | { type: 'YOUTUBE_NAVIGATED'; videoId: string };

export type ContentRequest =
  | { type: 'GET_VIDEO_CONTEXT' }
  | { type: 'GET_PLAYER_TRANSCRIPT'; videoId: string; track: CaptionTrack }
  | { type: 'FETCH_PAGE_TRANSCRIPT'; videoId: string; track: CaptionTrack; trackCount?: number };

export type RuntimeSuccess<T> = { ok: true; data: T };
export type RuntimeFailure = { ok: false; error: { code: string; message: string } };
export type RuntimeResponse<T> = RuntimeSuccess<T> | RuntimeFailure;

export type TranscriptResult = {
  segments: TranscriptSegment[];
  text: string;
  provenance: TranscriptProvenance;
};

export type TranscriptSource = 'player-timedtext' | 'background-timedtext' | 'page-timedtext' | 'youtubei' | 'native-dom';

export type TranscriptProvenance = {
  source: TranscriptSource;
  videoId: string;
  trackId: string;
  languageCode: string;
  translation: string | null;
  fetchedAt: number;
  cacheHit: boolean;
  fallbackErrors: string[];
};

export type DraftClaim = { token: string; content: string } | null;

export type VideoContextResponse = RuntimeResponse<VideoContext>;
