import { fillComposer, waitForComposer } from '../src/lib/chatgpt/composer-adapter';
import type { DraftClaim, RuntimeResponse } from '../src/types/messages';

function makeFallbackPanel(content: string): void {
  if (document.getElementById('ezsubtitle-chatgpt-fallback')) return;
  const host = document.createElement('div');
  host.id = 'ezsubtitle-chatgpt-fallback';
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const card = document.createElement('section');
  card.setAttribute('role', 'status');
  card.innerHTML = `<style>
    :host { all: initial; }
    section { box-sizing:border-box; width:300px; padding:16px; border:1px solid #d4a72c; border-radius:12px; background:#fffdf5; color:#251d08; box-shadow:0 12px 30px rgba(0,0,0,.22); font:14px/1.45 ui-sans-serif,system-ui,sans-serif; }
    h2 { margin:0 0 7px; font-size:15px; } p { margin:0 0 13px; } .actions { display:flex; gap:8px; } button { border:0; border-radius:8px; padding:8px 10px; font:inherit; cursor:pointer; } #copy { background:#6b4f00; color:white; } #close { background:#ece6d7; color:#382e15; }
  </style><h2>EzSubtitle chưa thể tự điền</h2><p id="message">Nội dung vẫn được giữ an toàn. Hãy sao chép rồi dán vào khung chat.</p><div class="actions"><button id="copy" type="button">Sao chép nội dung</button><button id="close" type="button">Đóng</button></div>`;
  shadow.append(card);
  shadow.getElementById('close')?.addEventListener('click', () => host.remove());
  shadow.getElementById('copy')?.addEventListener('click', async () => {
    const message = shadow.getElementById('message');
    try {
      await navigator.clipboard.writeText(content);
      if (message) message.textContent = 'Đã sao chép — hãy dán vào ChatGPT.';
    } catch {
      if (message) message.textContent = 'Không thể sao chép. Vui lòng thử lại sau.';
    }
  });
  document.documentElement.append(host);
}

async function claimDraft(timeoutMs = 1_000): Promise<DraftClaim> {
  const deadline = Date.now() + timeoutMs;
  do {
    const response = await chrome.runtime.sendMessage({ type: 'CLAIM_CHATGPT_DRAFT' }) as RuntimeResponse<DraftClaim>;
    if (response?.ok && response.data) return response.data;
    if (Date.now() < deadline) await new Promise((resolve) => window.setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  return null;
}

async function runHandoff(): Promise<void> {
  const composer = await waitForComposer();
  const draft = await claimDraft();
  if (!draft) return;
  if (!composer || !fillComposer(composer, draft.content)) {
    makeFallbackPanel(draft.content);
    return;
  }
  await chrome.runtime.sendMessage({ type: 'MARK_CHATGPT_DRAFT_FILLED', token: draft.token });
}

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_idle',
  main() {
    void runHandoff();
  },
});

export { makeFallbackPanel, runHandoff };
