type TranscriptPreviewProps = {
  text: string;
  segmentCount: number;
};

export function TranscriptPreview({ text, segmentCount }: TranscriptPreviewProps) {
  return (
    <section className="transcript-preview" aria-label="Toàn bộ phụ đề">
      <div className="transcript-preview__meta">
        <span>{segmentCount} đoạn</span>
        <span>{text.length.toLocaleString('vi-VN')} ký tự</span>
      </div>
      <textarea readOnly value={text} aria-label="Nội dung phụ đề" spellCheck={false} />
    </section>
  );
}
