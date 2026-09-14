export type TranscriptErrorCode =
  | 'INVALID_CAPTION_URL'
  | 'CAPTION_UNAVAILABLE'
  | 'EMPTY_RESPONSE'
  | 'TRANSCRIPT_ENDPOINT_UNAVAILABLE'
  | 'MISSING_TIMESTAMP'
  | 'NETWORK_ERROR'
  | 'UNPARSEABLE_RESPONSE'
  | 'NATIVE_TRANSCRIPT_UNSTABLE'
  | 'STALE_VIDEO';

const messages: Record<TranscriptErrorCode, string> = {
  INVALID_CAPTION_URL: 'Đường dẫn phụ đề không hợp lệ.',
  CAPTION_UNAVAILABLE: 'YouTube hiện không cho phép tải caption track này.',
  EMPTY_RESPONSE: 'YouTube trả về transcript rỗng hoặc tạm thời chưa cung cấp dữ liệu.',
  TRANSCRIPT_ENDPOINT_UNAVAILABLE: 'Transcript endpoint hiện tại của YouTube không khả dụng cho track này.',
  MISSING_TIMESTAMP: 'Đã tìm thấy nội dung transcript nhưng không có timestamp hợp lệ.',
  NETWORK_ERROR: 'Lỗi mạng khi tải transcript. Hãy kiểm tra kết nối rồi thử lại.',
  UNPARSEABLE_RESPONSE: 'YouTube trả về transcript nhưng định dạng không thể đọc được.',
  NATIVE_TRANSCRIPT_UNSTABLE: 'Transcript native chưa ổn định hoàn toàn. Hãy thử lại.',
  STALE_VIDEO: 'Video đã thay đổi trước khi transcript tải xong. Hãy thử lại.',
};

export class TranscriptFetchError extends Error {
  constructor(
    public readonly code: TranscriptErrorCode,
    message = messages[code],
  ) {
    super(message);
    this.name = 'TranscriptFetchError';
  }
}

export function transcriptErrorMessage(code: TranscriptErrorCode): string {
  return messages[code];
}
