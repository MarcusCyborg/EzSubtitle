export type PlayerResponseSnapshot = {
  videoDetails?: { videoId?: string; title?: string };
  captions?: unknown;
};

export function isPlayerResponseSnapshot(value: unknown): value is PlayerResponseSnapshot {
  return Boolean(value) && typeof value === 'object';
}

export function parsePlayerResponseJson(value: unknown): PlayerResponseSnapshot | null {
  if (isPlayerResponseSnapshot(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlayerResponseSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
