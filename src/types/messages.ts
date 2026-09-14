import type { CaptionTrack, TranscriptSegment, VideoContext } from './transcript';

export type RuntimeRequest =
  | { type: 'FETCH_TRANSCRIPT'; videoId: string; track: CaptionTrack; trackCount?: number; tabId?: number }
  | { type: 'PREPARE_CHATGPT_DRAFT'; transcript: string }
  | { type: 'CLAIM_CHATGPT_DRAFT' }
  | { type: 'MARK_CHATGPT_DRAFT_FILLED'; token: string }
  | { type: 'YOUTUBE_NAVIGATED'; videoId: string };

export type ContentRequest =
  | { type: 'GET_VIDEO_CONTEXT' }
  | { type: 'FETCH_PAGE_TRANSCRIPT'; videoId: string; track: CaptionTrack; trackCount?: number };

export type RuntimeSuccess<T> = { ok: true; data: T };
export type RuntimeFailure = { ok: false; error: { code: string; message: string } };
export type RuntimeResponse<T> = RuntimeSuccess<T> | RuntimeFailure;

export type TranscriptResult = {
  segments: TranscriptSegment[];
  text: string;
};

export type DraftClaim = { token: string; content: string } | null;

export type VideoContextResponse = RuntimeResponse<VideoContext>;
