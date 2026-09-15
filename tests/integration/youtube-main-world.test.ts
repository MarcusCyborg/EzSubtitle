import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectYoutubeiTranscript } from '../../src/lib/transcript/parse-youtubei';
import { inspectNativeTranscript, nativeInspectionSignature } from '../../src/lib/youtube/native-transcript';
import type { PageBridgeRequest } from '../../src/lib/youtube/page-bridge';

const VIDEO_ID = 'I8XaYkRW1tA';
const DEFAULT_PARAMS = 'DEFAULT_ENDPOINT_1234567890';
const VIETNAMESE_PARAMS = 'VIETNAMESE_ENDPOINT_123456';
const requestId = '48c6d11a-0c04-4a22-bd7f-d19d297ef949';

let handlePageRequest: typeof import('../../entrypoints/youtube-main-world.content')['handlePageRequest'];
let waitForStableNativeTranscript: typeof import('../../entrypoints/youtube-main-world.content')['waitForStableNativeTranscript'];

function transcriptBody(language: 'en' | 'vi', includeMenu = false): string {
  const text = language === 'vi' ? 'Xin chào từ tiếng Việt' : 'Hello from English';
  const searchPanel = {
    body: { transcriptSegmentListRenderer: { initialSegments: [{
      transcriptSegmentRenderer: { startMs: '1000', snippet: { runs: [{ text }] } },
    }] } },
    ...(includeMenu ? { footer: { transcriptFooterRenderer: { languageMenu: {
      sortFilterSubMenuRenderer: { subMenuItems: [
        { title: 'English', languageCode: 'en', vssId: '.en', selected: true },
        {
          title: 'Tiếng Việt',
          languageCode: 'vi',
          vssId: '.vi',
          continuation: { reloadContinuationData: { continuation: VIETNAMESE_PARAMS } },
        },
      ] },
    } } } } : {}),
  };
  return JSON.stringify({ actions: [{ updateEngagementPanelAction: { content: {
    transcriptRenderer: { content: { transcriptSearchPanelRenderer: searchPanel } },
  } } }] });
}

function endpointRequest(track: { id: string; languageCode: string; label: string }): PageBridgeRequest {
  return { requestId, action: 'FETCH_TRANSCRIPT_ENDPOINT', videoId: VIDEO_ID, track };
}

function nativeRequest(
  track: { id: string; languageCode: string; label: string },
  isOnlyTrack = false,
): PageBridgeRequest {
  return { requestId, action: 'FETCH_NATIVE_TRANSCRIPT', videoId: VIDEO_ID, track, isOnlyTrack };
}

function installNativeTranscriptFixture(initialIndex = 0): { panel: HTMLElement; closeButton: HTMLButtonElement } {
  const player = document.createElement('div') as HTMLDivElement & { getPlayerResponse?: () => unknown };
  player.id = 'movie_player';
  player.getPlayerResponse = () => ({
    videoDetails: { videoId: VIDEO_ID, title: 'Fixture video' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      {
        baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en`,
        languageCode: 'en', vssId: '.en', name: { simpleText: 'English' },
      },
      {
        baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=vi`,
        languageCode: 'vi', vssId: '.vi', name: { simpleText: 'Tiếng Việt' },
      },
    ] } },
  });

  const opener = document.createElement('ytd-video-description-transcript-section-renderer');
  const openButton = document.createElement('button');
  opener.append(openButton);

  const panel = document.createElement('ytd-engagement-panel-section-list-renderer');
  panel.setAttribute('target-id', 'engagement-panel-searchable-transcript');
  panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  panel.innerHTML = `
    <ytd-engagement-panel-title-header-renderer><div id="visibility-button"><button></button></div></ytd-engagement-panel-title-header-renderer>
    <yt-dropdown-menu><button id="label"></button><tp-yt-paper-listbox><a>English</a><a>Tiếng Việt</a></tp-yt-paper-listbox></yt-dropdown-menu>
    <ytd-transcript-segment-list-renderer></ytd-transcript-segment-list-renderer>
  `;
  const menu = panel.querySelector('yt-dropdown-menu') as HTMLElement & { data?: unknown; selected?: number };
  const closeButton = panel.querySelector<HTMLButtonElement>('#visibility-button button') as HTMLButtonElement;
  const list = panel.querySelector('ytd-transcript-segment-list-renderer') as HTMLElement;
  const render = (language: 'en' | 'vi') => {
    const segment = document.createElement('ytd-transcript-segment-renderer') as HTMLElement & { data?: unknown };
    segment.data = language === 'vi'
      ? { startMs: '6878', snippet: { runs: [{ text: 'Vào tháng 7 năm 2025,' }] } }
      : { startMs: '6878', snippet: { runs: [{ text: 'In July of 2025,' }] } };
    list.replaceChildren(segment);
  };
  const setSelected = (index: number) => {
    menu.selected = index;
    menu.data = [
      { title: 'English', selected: index === 0 },
      { title: 'Tiếng Việt', selected: index === 1 },
    ];
    render(index === 1 ? 'vi' : 'en');
  };
  menu.querySelectorAll('a').forEach((item, index) => item.addEventListener('click', () => setSelected(index)));
  setSelected(initialIndex);
  openButton.addEventListener('click', () => panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'));
  closeButton.addEventListener('click', () => panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'));
  document.body.append(player, opener, panel);
  return { panel, closeButton };
}

function installSingleTrackNativeTranscriptFixture(): void {
  const player = document.createElement('div') as HTMLDivElement & { getPlayerResponse?: () => unknown };
  player.id = 'movie_player';
  player.getPlayerResponse = () => ({
    videoDetails: { videoId: VIDEO_ID, title: 'Single-track fixture' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [{
      baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=vi&kind=asr`,
      languageCode: 'vi', vssId: 'a.vi', kind: 'asr', name: { simpleText: 'Tiếng Việt (được tạo tự động)' },
    }] } },
  });

  const opener = document.createElement('ytd-video-description-transcript-section-renderer');
  const openButton = document.createElement('button');
  opener.append(openButton);
  const panel = document.createElement('ytd-engagement-panel-section-list-renderer');
  panel.setAttribute('target-id', 'engagement-panel-searchable-transcript');
  panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  panel.innerHTML = `
    <ytd-engagement-panel-title-header-renderer><div id="visibility-button"><button></button></div></ytd-engagement-panel-title-header-renderer>
    <yt-dropdown-menu></yt-dropdown-menu>
    <ytd-transcript-segment-list-renderer><ytd-transcript-segment-renderer></ytd-transcript-segment-renderer></ytd-transcript-segment-list-renderer>
  `;
  const segment = panel.querySelector('ytd-transcript-segment-renderer') as HTMLElement & { data?: unknown };
  segment.data = { startMs: '0', snippet: { simpleText: 'Phụ đề một track.' }, targetId: 'opaque-vi:0:2000' };
  openButton.addEventListener('click', () => panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'));
  panel.querySelector<HTMLButtonElement>('#visibility-button button')?.addEventListener('click', () => {
    panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  });
  document.body.append(player, opener, panel);
}

function installStableWaitFixture(initial: 'en' | 'vi', withTargetIds = true) {
  const panel = document.createElement('section');
  panel.innerHTML = '<yt-dropdown-menu></yt-dropdown-menu><ytd-transcript-segment-list-renderer></ytd-transcript-segment-list-renderer>';
  const menu = panel.querySelector('yt-dropdown-menu') as HTMLElement & { data?: unknown; selected?: number };
  const list = panel.querySelector('ytd-transcript-segment-list-renderer') as HTMLElement;
  const setSelected = (language: 'en' | 'vi') => {
    const index = language === 'en' ? 0 : 1;
    menu.selected = index;
    menu.data = [
      { title: 'English', selected: index === 0 },
      { title: 'Tiếng Việt', selected: index === 1 },
    ];
  };
  const render = (languages: Array<'en' | 'vi'>, count = 2) => {
    const renderers = languages.flatMap((language) => Array.from({ length: count }, (_, index) => {
      const renderer = document.createElement('ytd-transcript-segment-renderer') as HTMLElement & { data?: unknown };
      const startMs = 1_000 + index * 3_000;
      const text = language === 'en' ? `English line ${index + 1}.` : `Dòng tiếng Việt ${index + 1}.`;
      renderer.data = {
        startMs: String(startMs),
        snippet: { simpleText: text },
        ...(withTargetIds ? { targetId: `opaque-${language}:${startMs}:${startMs + 2_000}` } : {}),
      };
      return renderer;
    }));
    list.replaceChildren(...renderers);
  };
  setSelected(initial);
  render([initial]);
  document.body.append(panel);
  return { panel, menu, render, setSelected };
}

beforeAll(async () => {
  vi.stubGlobal('defineContentScript', (value: unknown) => value);
  ({ handlePageRequest, waitForStableNativeTranscript } = await import('../../entrypoints/youtube-main-world.content'));
});

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, '', `/watch?v=${VIDEO_ID}`);
  Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, value: undefined });
  Object.defineProperty(window, 'ytInitialData', {
    configurable: true,
    value: {
      engagementPanels: [{ unrelated: true }, {
        engagementPanelSectionListRenderer: { content: { continuationItemRenderer: {
          continuationEndpoint: { getTranscriptEndpoint: { params: DEFAULT_PARAMS } },
        } } },
      }],
    },
  });
  const config: Record<string, unknown> = {
    INNERTUBE_API_KEY: 'fixture-key',
    INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: '1.0' } },
    INNERTUBE_CONTEXT_CLIENT_NAME: 1,
    INNERTUBE_CLIENT_VERSION: '1.0',
    VISITOR_DATA: 'fixture-visitor',
  };
  Object.defineProperty(window, 'ytcfg', {
    configurable: true,
    value: { get: (key: string) => config[key] },
  });
});

describe('MAIN-world transcript fallback', () => {
  it.each([false, true])('reads the new In this video panel with chapters selected: %s', async (chaptersSelected) => {
    vi.useFakeTimers();
    installNativeTranscriptFixture();
    document.querySelector('ytd-video-description-transcript-section-renderer')?.remove();
    const player = document.querySelector('#movie_player') as HTMLElement & { getPlayerResponse: () => unknown };
    player.getPlayerResponse = () => ({
      videoDetails: { videoId: VIDEO_ID },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{
        baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en&kind=asr`,
        languageCode: 'en', vssId: 'a.en', kind: 'asr', name: { simpleText: 'English (auto-generated)' },
      }] } },
    });
    document.body.insertAdjacentHTML('beforeend', readFileSync(resolve('tests/fixtures/native-timeline.html'), 'utf8'));
    const panel = document.querySelector<HTMLElement>('[target-id="engagement-panel-search-in-video"]')!;
    const content = panel.querySelector<HTMLElement>('.transcript-content')!;
    const chapterTab = panel.querySelector<HTMLElement>('[role="tab"]:first-child')!;
    const tab = panel.querySelector<HTMLElement>('[role="tab"]:last-child')!;
    if (chaptersSelected) {
      content.hidden = true;
      chapterTab.setAttribute('aria-selected', 'true');
      tab.setAttribute('aria-selected', 'false');
      tab.addEventListener('click', () => {
        content.hidden = false;
        chapterTab.setAttribute('aria-selected', 'false');
        tab.setAttribute('aria-selected', 'true');
      });
      chapterTab.addEventListener('click', () => {
        content.hidden = true;
        chapterTab.setAttribute('aria-selected', 'true');
        tab.setAttribute('aria-selected', 'false');
      });
    }
    const pending = handlePageRequest(
      nativeRequest({ id: 'a.en', languageCode: 'en', label: 'English (auto-generated)' }),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({
      ok: true,
      data: { segments: [
        { startMs: 7_000, text: 'everyone. And what I want to explain [music] to you today,' },
        { startMs: 15_000, text: 'supply chains, I now recognize and I have a framework to' },
      ] },
    });
    expect(panel.getAttribute('visibility')).toBe('ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    expect(chapterTab.getAttribute('aria-selected')).toBe(chaptersSelected ? 'true' : 'false');
    expect(content.hidden).toBe(chaptersSelected);
  });

  it('prefers the current player API and refuses a stale global player response', async () => {
    const currentVideoId = 'dQw4w9WgXcQ';
    window.history.replaceState({}, '', `/watch?v=${currentVideoId}`);
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      value: { videoDetails: { videoId: VIDEO_ID, title: 'Stale video A' }, captions: {} },
    });
    const player = document.createElement('div') as HTMLDivElement & { getPlayerResponse?: () => unknown };
    player.id = 'movie_player';
    player.getPlayerResponse = () => ({
      videoDetails: { videoId: currentVideoId, title: 'Current video B' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{
        baseUrl: `https://www.youtube.com/api/timedtext?v=${currentVideoId}&lang=en`,
        languageCode: 'en', vssId: '.en', name: { simpleText: 'English' },
      }] } },
    });
    document.body.append(player);

    const current = await handlePageRequest(
      { requestId, action: 'GET_SNAPSHOT', videoId: currentVideoId },
      new AbortController().signal,
    );
    expect(current).toMatchObject({ ok: true, data: { snapshot: { videoDetails: { videoId: currentVideoId, title: 'Current video B' } } } });

    player.remove();
    const staleOnly = await handlePageRequest(
      { requestId, action: 'GET_SNAPSHOT', videoId: currentVideoId },
      new AbortController().signal,
    );
    expect(staleOnly).toMatchObject({ ok: true, data: { snapshot: null } });
  });

  it('finds the default endpoint below arrays and reuses its English response', async () => {
    const transport = vi.fn(async () => new Response(transcriptBody('en', true)));
    vi.stubGlobal('fetch', transport);

    const response = await handlePageRequest(endpointRequest({ id: '.en', languageCode: 'en', label: 'English' }), new AbortController().signal);

    expect(response).toMatchObject({ ok: true, action: 'FETCH_TRANSCRIPT_ENDPOINT' });
    expect(transport).toHaveBeenCalledTimes(1);
    if (response.ok && response.action === 'FETCH_TRANSCRIPT_ENDPOINT') {
      expect(inspectYoutubeiTranscript(response.data.body).segments[0]?.text).toBe('Hello from English');
    }
    expect(JSON.stringify(response)).not.toContain('engagementPanels');
  });

  it('uses the Vietnamese reload endpoint exposed by the default response', async () => {
    const requestedParams: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const params = JSON.parse(String(init?.body)) as { params: string };
      requestedParams.push(params.params);
      return new Response(params.params === VIETNAMESE_PARAMS ? transcriptBody('vi') : transcriptBody('en', true));
    }));

    const response = await handlePageRequest(endpointRequest({ id: '.vi', languageCode: 'vi', label: 'Tiếng Việt' }), new AbortController().signal);

    expect(requestedParams).toEqual([DEFAULT_PARAMS, VIETNAMESE_PARAMS]);
    expect(response).toMatchObject({ ok: true });
    if (response.ok && response.action === 'FETCH_TRANSCRIPT_ENDPOINT') {
      expect(inspectYoutubeiTranscript(response.data.body).segments[0]?.text).toBe('Xin chào từ tiếng Việt');
      expect(response.data.body).not.toContain('Hello from English');
    }
  });

  it('classifies an empty selected-track endpoint without inventing missing timestamps', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const { params } = JSON.parse(String(init?.body)) as { params: string };
      return new Response(params === VIETNAMESE_PARAMS ? '' : transcriptBody('en', true));
    }));

    await expect(handlePageRequest(
      endpointRequest({ id: '.vi', languageCode: 'vi', label: 'Tiếng Việt' }),
      new AbortController().signal,
    )).resolves.toMatchObject({ ok: false, error: { code: 'EMPTY_RESPONSE' } });
  });

  it('rejects a response after the tab navigates to another video', async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finishRequest = resolve; })));
    const pending = handlePageRequest(
      endpointRequest({ id: '.en', languageCode: 'en', label: 'English' }),
      new AbortController().signal,
    );
    window.history.pushState({}, '', '/watch?v=dQw4w9WgXcQ');
    finishRequest?.(new Response(transcriptBody('en', true)));

    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'STALE_VIDEO' } });
  });

  it('lets YouTube switch its native language menu and reads exact renderer startMs', async () => {
    const { panel, closeButton } = installNativeTranscriptFixture();
    const menu = panel.querySelector('yt-dropdown-menu') as HTMLElement & { selected?: number };
    const closeSpy = vi.spyOn(closeButton, 'click');

    const english = await handlePageRequest(
      nativeRequest({ id: '.en', languageCode: 'en', label: 'English' }),
      new AbortController().signal,
    );
    const vietnamese = await handlePageRequest(
      nativeRequest({ id: '.vi', languageCode: 'vi', label: 'Tiếng Việt' }),
      new AbortController().signal,
    );

    expect(english).toMatchObject({ ok: true, data: { segments: [{ startMs: 6_878, text: 'In July of 2025,' }] } });
    expect(vietnamese).toMatchObject({ ok: true, data: { segments: [{ startMs: 6_878, text: 'Vào tháng 7 năm 2025,' }] } });
    expect(menu.selected).toBe(0);
    expect(panel.getAttribute('visibility')).toBe('ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
    expect(closeSpy).toHaveBeenCalledTimes(2);
  });

  it('reads a single native track when YouTube omits usable language-menu data', async () => {
    vi.useFakeTimers();
    installSingleTrackNativeTranscriptFixture();
    const pending = handlePageRequest(
      nativeRequest({ id: 'a.vi', languageCode: 'vi', label: 'Tiếng Việt (được tạo tự động)' }, true),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({
      ok: true,
      data: { segments: [{ startMs: 0, text: 'Phụ đề một track.' }] },
    });
  });

  it('reads stable English lines with distinct renderer IDs instead of timing out', async () => {
    vi.useFakeTimers();
    const { panel } = installNativeTranscriptFixture();
    const list = panel.querySelector('ytd-transcript-segment-list-renderer')!;
    list.replaceChildren(...[0, 1, 2].map((index) => {
      const segment = document.createElement('ytd-transcript-segment-renderer') as HTMLElement & { data?: unknown };
      segment.data = { targetId: `transcript-segment-${index}`, startMs: index * 2_000, snippet: { simpleText: `English line ${index}.` } };
      return segment;
    }));
    const pending = handlePageRequest(nativeRequest({ id: '.en', languageCode: 'en', label: 'English' }), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({
      ok: true, data: { segments: [{ text: 'English line 0.' }, { text: 'English line 1.' }, { text: 'English line 2.' }] },
    });
  });

  it('accepts changed stable language content even when YouTube reuses the renderer ID prefix', async () => {
    vi.useFakeTimers();
    const fixture = installStableWaitFixture('vi');
    const prior = inspectNativeTranscript(fixture.panel);
    const pending = waitForStableNativeTranscript(fixture.panel, () => fixture.menu.selected === 0, new AbortController().signal, {
      priorSignature: nativeInspectionSignature(prior), requireChange: true, timeoutMs: 1_500,
    });
    fixture.setSelected('en');
    fixture.render(['en']);
    fixture.panel.querySelectorAll('ytd-transcript-segment-renderer').forEach((element) => {
      const segment = element as HTMLElement & { data: { targetId: string } };
      segment.data.targetId = segment.data.targetId.replace('opaque-en', 'opaque-vi');
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ segments: [{ text: 'English line 1.' }, { text: 'English line 2.' }] });
  });

  it('recognizes numeric string menu selection without waiting for a nonexistent language change', async () => {
    vi.useFakeTimers();
    const { panel } = installNativeTranscriptFixture();
    const menu = panel.querySelector('yt-dropdown-menu') as HTMLElement & { selected: string; data: Array<{ title: string }> };
    menu.selected = '0';
    menu.data = [{ title: 'English' }, { title: 'Tiếng Việt' }];
    const click = vi.spyOn(menu.querySelector('a')!, 'click');
    const pending = handlePageRequest(nativeRequest({ id: '.en', languageCode: 'en', label: 'English' }), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    ['vi', 'en', 'English line 1.'],
    ['en', 'vi', 'Dòng tiếng Việt 1.'],
  ] as const)('waits through %s -> mixed -> %s before resolving', async (initial, requested, expectedText) => {
    vi.useFakeTimers();
    const fixture = installStableWaitFixture(initial);
    const prior = inspectNativeTranscript(fixture.panel);
    const targetIndex = requested === 'en' ? 0 : 1;
    let resolved = false;
    const pending = waitForStableNativeTranscript(
      fixture.panel,
      () => fixture.menu.selected === targetIndex,
      new AbortController().signal,
      {
        priorSignature: nativeInspectionSignature(prior),
        requireChange: true,
        settleMs: 600,
        timeoutMs: 3_000,
      },
    ).then((inspection) => {
      resolved = true;
      return inspection;
    });

    fixture.setSelected(requested);
    fixture.render([requested, initial]);
    window.setTimeout(() => fixture.render([requested]), 200);
    await vi.advanceTimersByTimeAsync(850);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(100);

    const result = await pending;
    expect(result.segments.map((segment) => segment.text)).toEqual([expectedText, expectedText.replace('1', '2')]);
    expect(result.trackKey).toBe(`opaque-${requested}`);
  });

  it('waits when segments change before the selected index and while count/signature still change', async () => {
    vi.useFakeTimers();
    const fixture = installStableWaitFixture('en');
    const prior = inspectNativeTranscript(fixture.panel);
    let resolved = false;
    const pending = waitForStableNativeTranscript(
      fixture.panel,
      () => fixture.menu.selected === 1,
      new AbortController().signal,
      {
        priorSignature: nativeInspectionSignature(prior),
        requireChange: true,
        settleMs: 600,
        timeoutMs: 3_000,
      },
    ).then((inspection) => {
      resolved = true;
      return inspection;
    });

    fixture.render(['en', 'vi']);
    window.setTimeout(() => fixture.render(['vi'], 1), 100);
    window.setTimeout(() => fixture.render(['vi'], 2), 350);
    window.setTimeout(() => fixture.setSelected('vi'), 450);
    await vi.advanceTimersByTimeAsync(900);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(300);

    await expect(pending).resolves.toMatchObject({
      segments: [{ text: 'Dòng tiếng Việt 1.' }, { text: 'Dòng tiếng Việt 2.' }],
      trackKey: 'opaque-vi',
    });
  });

  it('never accepts two targetId track keys that coexist in a settled DOM', async () => {
    vi.useFakeTimers();
    const fixture = installStableWaitFixture('en');
    const prior = inspectNativeTranscript(fixture.panel);
    const pending = waitForStableNativeTranscript(
      fixture.panel,
      () => fixture.menu.selected === 1,
      new AbortController().signal,
      {
        priorSignature: nativeInspectionSignature(prior),
        requireChange: true,
        settleMs: 600,
        timeoutMs: 1_200,
      },
    );
    fixture.setSelected('vi');
    fixture.render(['en', 'vi']);
    const rejection = expect(pending).rejects.toThrow('NATIVE_TRANSCRIPT_UNSTABLE');
    await vi.advanceTimersByTimeAsync(1_300);

    await rejection;
  });

  it('falls back to selected menu, changed signature, stable count/content, and quiet period without targetId', async () => {
    vi.useFakeTimers();
    const fixture = installStableWaitFixture('vi', false);
    const prior = inspectNativeTranscript(fixture.panel);
    const pending = waitForStableNativeTranscript(
      fixture.panel,
      () => fixture.menu.selected === 0,
      new AbortController().signal,
      { priorSignature: nativeInspectionSignature(prior), requireChange: true, settleMs: 600, timeoutMs: 2_000 },
    );
    fixture.setSelected('en');
    fixture.render(['en', 'vi']);
    window.setTimeout(() => fixture.render(['en']), 150);
    await vi.advanceTimersByTimeAsync(900);

    await expect(pending).resolves.toMatchObject({
      hasTargetIds: false,
      segments: [{ text: 'English line 1.' }, { text: 'English line 2.' }],
    });
  });

  it('ignores playback attribute churn when transcript content is stable', async () => {
    vi.useFakeTimers();
    const fixture = installStableWaitFixture('en');
    let resolved = false;
    const pending = waitForStableNativeTranscript(
      fixture.panel,
      () => fixture.menu.selected === 0,
      new AbortController().signal,
      { settleMs: 600, timeoutMs: 1_500 },
    ).then((inspection) => {
      resolved = true;
      return inspection;
    });
    const segment = fixture.panel.querySelector<HTMLElement>('ytd-transcript-segment-renderer');
    const churn = window.setInterval(() => {
      segment?.toggleAttribute('is-active');
    }, 50);

    await vi.advanceTimersByTimeAsync(900);
    window.clearInterval(churn);

    expect(resolved).toBe(true);
    await expect(pending).resolves.toMatchObject({
      segments: [{ text: 'English line 1.' }, { text: 'English line 2.' }],
      trackKey: 'opaque-en',
    });
  });

  it('aborts a native settle and rejects a stale SPA navigation result', async () => {
    vi.useFakeTimers();
    const fixture = installStableWaitFixture('vi');
    const prior = inspectNativeTranscript(fixture.panel);
    const controller = new AbortController();
    const pending = waitForStableNativeTranscript(
      fixture.panel,
      () => fixture.menu.selected === 0,
      controller.signal,
      {
        priorSignature: nativeInspectionSignature(prior),
        requireChange: true,
        settleMs: 600,
        timeoutMs: 2_000,
      },
    );
    fixture.setSelected('en');
    fixture.render(['en']);
    await vi.advanceTimersByTimeAsync(300);
    controller.abort();

    await expect(pending).rejects.toThrow('STALE_VIDEO');
  });

  it('serializes rapid English -> Vietnamese -> English requests and aborts both stale responses', async () => {
    vi.useFakeTimers();
    installNativeTranscriptFixture(1);
    const firstEnglish = handlePageRequest(
      nativeRequest({ id: '.en', languageCode: 'en', label: 'English' }),
      new AbortController().signal,
    );
    const vietnamese = handlePageRequest(
      nativeRequest({ id: '.vi', languageCode: 'vi', label: 'Tiếng Việt' }),
      new AbortController().signal,
    );
    const finalEnglish = handlePageRequest(
      nativeRequest({ id: '.en', languageCode: 'en', label: 'English' }),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(firstEnglish).resolves.toMatchObject({ ok: false, error: { code: 'STALE_VIDEO' } });
    await expect(vietnamese).resolves.toMatchObject({ ok: false, error: { code: 'STALE_VIDEO' } });
    await expect(finalEnglish).resolves.toMatchObject({
      ok: true,
      data: { segments: [{ startMs: 6_878, text: 'In July of 2025,' }] },
    });
  });

  it('does not return settled native data after SPA navigation changes the video', async () => {
    vi.useFakeTimers();
    installNativeTranscriptFixture(1);
    const pending = handlePageRequest(
      nativeRequest({ id: '.en', languageCode: 'en', label: 'English' }),
      new AbortController().signal,
    );
    window.history.pushState({}, '', '/watch?v=dQw4w9WgXcQ');
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'STALE_VIDEO' } });
  });
});
