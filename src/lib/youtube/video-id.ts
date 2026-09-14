const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(value: string): boolean {
  return VIDEO_ID_PATTERN.test(value);
}

export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (isValidVideoId(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (!['https:', 'http:'].includes(url.protocol)) return null;

    const host = url.hostname.replace(/^(www\.|m\.)/, '').toLowerCase();
    const candidate = host === 'youtu.be'
      ? url.pathname.split('/').filter(Boolean)[0]
      : host === 'youtube.com'
        ? url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/)?.[1]
        : null;

    return candidate && isValidVideoId(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function isYouTubeVideoUrl(url: string): boolean {
  return parseVideoId(url) !== null;
}
