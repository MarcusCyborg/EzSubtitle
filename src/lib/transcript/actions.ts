import { subtitleFilename } from './format';

export async function copyTranscriptText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function downloadTranscriptText(text: string, videoTitle: string, languageCode: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = subtitleFilename(videoTitle, languageCode);
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
