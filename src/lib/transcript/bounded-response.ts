const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export async function fetchBoundedText(
  transport: typeof fetch, url: string, init: RequestInit, signal: AbortSignal,
): Promise<{ status: number; ok: boolean; body: string }> {
  signal.throwIfAborted();
  const response = await transport(url, { ...init, credentials: 'include', redirect: 'error', signal });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    if (response.ok) throw new Error('RESPONSE_TOO_LARGE');
    return { status: response.status, ok: false, body: '' };
  }
  const reader = response.body?.getReader();
  const abort = () => { void reader?.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    signal.throwIfAborted();
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          abort();
          throw new Error('RESPONSE_TOO_LARGE');
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
    chunks.push(decoder.decode());
    return { status: response.status, ok: true, body: chunks.join('') };
  } finally {
    signal.removeEventListener('abort', abort);
    reader?.releaseLock();
  }
}
