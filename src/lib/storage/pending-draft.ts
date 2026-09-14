type PendingDraft = {
  token: string;
  content: string;
  tabId: number | null;
  createdAt: number;
};

const STORAGE_KEY = 'ezsubtitle:pending-chatgpt-drafts';
type PendingDrafts = Record<string, PendingDraft>;

function newToken(): string {
  return crypto.randomUUID();
}

export async function createPendingDraft(content: string): Promise<PendingDraft> {
  const draft: PendingDraft = { token: newToken(), content, tabId: null, createdAt: Date.now() };
  const drafts = await readPendingDrafts();
  await chrome.storage.session.set({ [STORAGE_KEY]: { ...drafts, [draft.token]: draft } satisfies PendingDrafts });
  return draft;
}

export async function attachDraftToTab(token: string, tabId: number): Promise<void> {
  const drafts = await readPendingDrafts();
  const draft = drafts[token];
  if (!draft) return;
  await chrome.storage.session.set({ [STORAGE_KEY]: { ...drafts, [token]: { ...draft, tabId } } satisfies PendingDrafts });
}

export async function claimDraftForTab(tabId: number): Promise<PendingDraft | null> {
  const drafts = await readPendingDrafts();
  return Object.values(drafts).find((draft) => draft.tabId === tabId) ?? null;
}

export async function removeClaimedDraft(token: string, tabId: number): Promise<void> {
  const drafts = await readPendingDrafts();
  if (drafts[token]?.tabId !== tabId) return;
  delete drafts[token];
  await chrome.storage.session.set({ [STORAGE_KEY]: drafts satisfies PendingDrafts });
}

async function readPendingDrafts(): Promise<PendingDrafts> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([token, draft]) => {
    if (!draft || typeof draft !== 'object') return [];
    const candidate = draft as Partial<PendingDraft>;
    return candidate.token === token && typeof candidate.content === 'string'
      && (typeof candidate.tabId === 'number' || candidate.tabId === null)
      && typeof candidate.createdAt === 'number' ? [[token, candidate as PendingDraft]] : [];
  }));
}
