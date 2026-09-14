const COMPOSER_SELECTORS = [
  'textarea[data-id="root"]',
  'textarea[placeholder*="Message"]',
  'textarea[placeholder*="Nhắn"]',
  '[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
];

export type Composer = HTMLTextAreaElement | HTMLElement;

export function findComposer(root: ParentNode = document): Composer | null {
  for (const selector of COMPOSER_SELECTORS) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable)) {
      return element;
    }
  }
  return null;
}

export async function waitForComposer(timeoutMs = 20_000): Promise<Composer | null> {
  const immediate = findComposer();
  if (immediate) return immediate;

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const composer = findComposer();
      if (!composer) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(composer);
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function dispatchInput(element: HTMLElement, inputType: string, data: string): void {
  element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data }));
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data }));
}

export function fillComposer(composer: Composer, content: string): boolean {
  composer.focus();
  if (composer instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(composer, content);
    dispatchInput(composer, 'insertText', content);
    return composer.value === content;
  }

  // execCommand triggers the same editor plumbing used by contenteditable composers.
  const inserted = document.execCommand('insertText', false, content);
  if (!inserted || !composer.textContent?.includes(content)) {
    composer.textContent = content;
    dispatchInput(composer, 'insertText', content);
  }
  return composer.textContent?.includes(content) ?? false;
}
