import type { TranscriptOutputMode } from '../../types/transcript';

export const OUTPUT_FORMAT_STORAGE_KEY = 'transcriptOutputFormat';
export const DEFAULT_OUTPUT_FORMAT: TranscriptOutputMode = 'readable';

export function isTranscriptOutputMode(value: unknown): value is TranscriptOutputMode {
  return value === 'readable' || value === 'detailed';
}

export async function getStoredOutputFormat(): Promise<TranscriptOutputMode> {
  const stored = await chrome.storage.local.get(OUTPUT_FORMAT_STORAGE_KEY);
  const value = stored[OUTPUT_FORMAT_STORAGE_KEY];
  return isTranscriptOutputMode(value) ? value : DEFAULT_OUTPUT_FORMAT;
}

export async function storeOutputFormat(mode: TranscriptOutputMode): Promise<void> {
  await chrome.storage.local.set({ [OUTPUT_FORMAT_STORAGE_KEY]: mode });
}
