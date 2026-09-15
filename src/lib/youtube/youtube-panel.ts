import type { RuntimeResponse, TranscriptResult, VideoContextResponse } from '../../types/messages';
import type { CaptionTrack, TranscriptOutputMode, TranscriptSegment, VideoContext } from '../../types/transcript';
import { DEFAULT_OUTPUT_FORMAT, getStoredOutputFormat, storeOutputFormat } from '../storage/output-format';
import { copyTranscriptText, downloadTranscriptText } from '../transcript/actions';
import { findActiveSegmentIndex } from '../transcript/active-segment';
import { formatTimestamp, formatTranscript } from '../transcript/format';
import { captionTrackDisplayLabel, selectDefaultTrack } from './caption-tracks';

type PanelServices = {
  loadContext: () => Promise<VideoContextResponse>;
  loadTranscript: (videoId: string, track: CaptionTrack, trackCount: number) => Promise<RuntimeResponse<TranscriptResult>>;
};

type PanelState = {
  context: VideoContext | null;
  expanded: boolean;
  feedback: { kind: 'info' | 'error'; message: string } | null;
  followPlayback: boolean;
  loading: boolean;
  outputMode: TranscriptOutputMode;
  selectedTrack: CaptionTrack | null;
  transcript: TranscriptResult | null;
  error: string | null;
};

const STORAGE_KEY = 'youtubePanelExpanded';
const HOST_ID = 'ezsubtitle-youtube-panel-host';

const panelCss = `
:host { display:block; width:100%; margin:0 0 16px; color:#0f0f0f; font-family:"Trebuchet MS", "Segoe UI", sans-serif; }
* { box-sizing:border-box; }
.card { --bg:#fffdf7; --surface:#f7f4ec; --text:#17232d; --muted:#68747d; --line:#d8d5cb; --accent:#b87315; --accent-soft:#fff1d6; --active:#f1e1bf; overflow:hidden; border:1px solid var(--line); border-radius:12px; background:var(--bg); box-shadow:0 1px 2px rgba(0,0,0,.08); }
:host-context(html[dark]) .card, :host-context([dark]) .card { --bg:#202124; --surface:#2b2c2f; --text:#f1f3f4; --muted:#aeb5ba; --line:#44474c; --accent:#f1b550; --accent-soft:#4a3a1d; --active:#443719; box-shadow:none; }
.header { display:flex; align-items:center; width:100%; min-height:48px; gap:9px; padding:8px 10px; border:0; color:var(--text); background:var(--bg); cursor:pointer; text-align:left; }
.header:hover { background:var(--surface); }
.header:focus-visible, .icon-button:focus-visible, select:focus-visible, .retry:focus-visible, .segment:focus-visible { outline:3px solid #e6ad42; outline-offset:-3px; }
.logo { width:27px; height:27px; border-radius:7px; object-fit:cover; }
.brand { flex:1; min-width:0; font:700 15px/1 Georgia, serif; letter-spacing:-.15px; }
.chevron { width:30px; height:30px; padding:6px; border:1px solid color-mix(in srgb, var(--accent) 45%, var(--line)); border-radius:999px; color:var(--accent); background:var(--accent-soft); box-shadow:0 1px 2px rgba(0,0,0,.08); fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:2.2; transition:transform .18s ease, background-color .18s ease; }
.header:hover .chevron { background:var(--active); }
.chevron--expanded { transform:rotate(180deg); }
.body { border-top:1px solid var(--line); }
.toolbar { display:flex; align-items:flex-end; justify-content:space-between; gap:8px; padding:9px 10px; background:var(--surface); }
.controls { display:grid; min-width:0; flex:1; grid-template-columns:minmax(0, 1.5fr) minmax(94px, .8fr); gap:7px; }
.field { display:grid; min-width:0; gap:3px; color:var(--muted); font:700 10px/1 "Trebuchet MS", "Segoe UI", sans-serif; }
select { width:100%; min-width:0; height:31px; padding:0 27px 0 9px; border:1px solid var(--line); border-radius:7px; color:var(--text); background:var(--bg); font:600 12px/1 "Trebuchet MS", "Segoe UI", sans-serif; }
.tools { display:flex; flex:0 0 auto; gap:2px; }
.icon-button { display:grid; width:31px; height:31px; place-items:center; padding:0; border:0; border-radius:7px; color:var(--text); background:transparent; cursor:pointer; }
.icon-button:hover:not(:disabled) { color:var(--accent); background:var(--accent-soft); }
.icon-button--active { color:var(--accent); background:var(--accent-soft); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent); }
.icon-button:disabled { opacity:.42; cursor:not-allowed; }
.icon-button svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.8; }
.status, .empty { padding:15px 13px; color:var(--muted); font-size:12px; line-height:1.45; }
.status--error { color:#9f3023; background:#fff0ec; }
:host-context(html[dark]) .status--error, :host-context([dark]) .status--error { color:#ffb4a9; background:#4d2522; }
.retry { margin-top:9px; padding:6px 9px; border:1px solid var(--line); border-radius:7px; color:var(--text); background:var(--bg); font:700 12px/1 "Trebuchet MS", "Segoe UI", sans-serif; cursor:pointer; }
.feedback { padding:7px 10px; color:#385637; background:#edf5e8; font-size:12px; }
.feedback--error { color:#9f3023; background:#fff0ec; }
:host-context(html[dark]) .feedback { color:#c9e7bc; background:#29402a; }
:host-context(html[dark]) .feedback--error { color:#ffb4a9; background:#4d2522; }
.transcript { max-height:min(66vh, 700px); overflow:auto; overscroll-behavior:contain; scrollbar-color:var(--line) transparent; }
.segment { display:grid; grid-template-columns:57px minmax(0,1fr); width:100%; gap:8px; padding:9px 10px; border:0; border-bottom:1px solid color-mix(in srgb, var(--line) 65%, transparent); color:var(--text); background:transparent; cursor:pointer; text-align:left; font:13px/1.45 "Trebuchet MS", "Segoe UI", sans-serif; }
.segment:hover { background:var(--surface); }
.segment--active { background:var(--active); }
.time { color:var(--accent); font:700 12px/1.55 "Courier New", monospace; white-space:nowrap; }
.text { overflow-wrap:anywhere; }
@media (max-width: 450px) { .toolbar { align-items:stretch; flex-direction:column; } .tools { align-self:flex-end; } .controls { grid-template-columns:1fr; } }
`;

function createIcon(path: string): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(namespace, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

function createIconButton(label: string, iconPath: string, disabled: boolean, onClick: () => void, pressed?: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  if (pressed !== undefined) {
    button.setAttribute('aria-pressed', String(pressed));
    button.classList.toggle('icon-button--active', pressed);
  }
  button.disabled = disabled;
  button.append(createIcon(iconPath));
  button.addEventListener('click', onClick);
  return button;
}

function sidebarContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('ytd-watch-flexy #secondary-inner')
    ?? document.querySelector<HTMLElement>('#secondary #secondary-inner')
    ?? document.querySelector<HTMLElement>('ytd-watch-flexy #secondary');
}

export class YoutubeTranscriptPanel {
  private activeIndex = -1;
  private feedbackTimer: number | null = null;
  private host: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private root: ShadowRoot | null = null;
  private scheduledMount = false;
  private sequence = 0;
  private state: PanelState = {
    context: null,
    expanded: false,
    feedback: null,
    followPlayback: true,
    loading: false,
    outputMode: DEFAULT_OUTPUT_FORMAT,
    selectedTrack: null,
    transcript: null,
    error: null,
  };
  private video: HTMLVideoElement | null = null;

  constructor(private readonly services: PanelServices) {}

  start(): void {
    this.observer = new MutationObserver(() => {
      const sidebar = sidebarContainer();
      const duplicateCount = document.querySelectorAll(`#${HOST_ID}`).length;
      if (sidebar && (!this.host?.isConnected || this.host.parentElement !== sidebar || duplicateCount > 1)) {
        this.scheduleMount();
      }
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', this.handleNavigation);
    void this.restoreExpandedState();
    this.ensureMounted();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener('yt-navigate-finish', this.handleNavigation);
    this.detachVideo();
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.host?.remove();
    this.host = null;
    this.root = null;
  }

  private readonly handleNavigation = (): void => {
    this.sequence += 1;
    this.activeIndex = -1;
    this.detachVideo();
    this.state = { ...this.state, context: null, selectedTrack: null, transcript: null, feedback: null, error: null, loading: false };
    this.render();
    this.scheduleMount();
    if (this.state.expanded) void this.loadContext();
  };

  private scheduleMount(): void {
    if (this.scheduledMount) return;
    this.scheduledMount = true;
    window.requestAnimationFrame(() => {
      this.scheduledMount = false;
      this.ensureMounted();
    });
  }

  private ensureMounted(): void {
    const sidebar = sidebarContainer();
    if (!sidebar) return;
    let hostChanged = false;
    if (!this.host) {
      this.createHost();
      hostChanged = true;
    }
    if (!this.host) return;
    for (const existing of document.querySelectorAll<HTMLElement>(`#${HOST_ID}`)) {
      if (existing !== this.host) existing.remove();
    }
    if (this.host.parentElement !== sidebar) {
      sidebar.prepend(this.host);
      hostChanged = true;
    }
    this.bindVideo();
    if (hostChanged) this.render();
    if (this.state.expanded && !this.state.context && !this.state.loading) void this.loadContext();
  }

  private createHost(): void {
    this.host = document.createElement('section');
    this.host.id = HOST_ID;
    this.host.setAttribute('aria-label', 'EzSubtitle transcript panel');
    this.root = this.host.attachShadow({ mode: 'open' });
  }

  private async restoreExpandedState(): Promise<void> {
    try {
      const [stored, outputMode] = await Promise.all([
        chrome.storage.local.get(STORAGE_KEY),
        getStoredOutputFormat(),
      ]);
      if (typeof stored[STORAGE_KEY] === 'boolean') this.state.expanded = stored[STORAGE_KEY] as boolean;
      this.state.outputMode = outputMode;
    } catch {
      this.setFeedback('Không thể lưu trạng thái panel trên trình duyệt này.', 'error');
    }
    this.render();
    if (this.state.expanded && !this.state.context && !this.state.loading) void this.loadContext();
  }

  private async loadContext(): Promise<void> {
    const sequence = ++this.sequence;
    this.state = { ...this.state, loading: true, error: null, transcript: null };
    this.render();
    try {
      const response = await this.services.loadContext();
      if (sequence !== this.sequence) return;
      if (!response.ok) throw new Error(response.error.message);
      const selectedTrack = selectDefaultTrack(response.data.tracks);
      if (!selectedTrack) throw new Error('Video này không có phụ đề khả dụng.');
      this.state = { ...this.state, context: response.data, selectedTrack, loading: false };
      this.render();
      await this.loadTrack(response.data, selectedTrack);
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.state = { ...this.state, loading: false, error: error instanceof Error ? error.message : 'Không thể tải thông tin video.' };
      this.render();
    }
  }

  private async loadTrack(context: VideoContext, track: CaptionTrack): Promise<void> {
    const sequence = ++this.sequence;
    this.activeIndex = -1;
    this.state = { ...this.state, selectedTrack: track, loading: true, error: null, transcript: null };
    this.render();
    try {
      const response = await this.services.loadTranscript(context.videoId, track, context.tracks.length);
      if (sequence !== this.sequence) return;
      if (!response.ok) throw new Error(response.error.message);
      this.state = { ...this.state, transcript: response.data, loading: false };
      this.render();
      this.syncActiveSegment();
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.state = { ...this.state, loading: false, error: error instanceof Error ? error.message : 'Không thể tải transcript.' };
      this.render();
    }
  }

  private toggleExpanded = (): void => {
    this.state = { ...this.state, expanded: !this.state.expanded };
    void chrome.storage.local.set({ [STORAGE_KEY]: this.state.expanded }).catch(() => {
      this.setFeedback('Không thể lưu trạng thái mở/đóng panel.', 'error');
    });
    this.render();
    if (this.state.expanded && !this.state.context && !this.state.loading) void this.loadContext();
  };

  private setFeedback(message: string, kind: 'info' | 'error'): void {
    this.state = { ...this.state, feedback: { message, kind } };
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => {
      this.state = { ...this.state, feedback: null };
      this.render();
    }, 2_600);
    this.render();
  }

  private bindVideo(): void {
    const candidate = document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
    if (candidate === this.video) return;
    this.detachVideo();
    this.video = candidate;
    this.video?.addEventListener('timeupdate', this.syncActiveSegment);
  }

  private detachVideo(): void {
    this.video?.removeEventListener('timeupdate', this.syncActiveSegment);
    this.video = null;
  }

  private readonly syncActiveSegment = (): void => {
    const segments = this.state.transcript?.segments;
    if (!segments || !this.video || !Number.isFinite(this.video.currentTime)) return;
    const nextIndex = findActiveSegmentIndex(segments, this.video.currentTime * 1_000);
    if (nextIndex !== this.activeIndex) {
      this.rowAt(this.activeIndex)?.classList.remove('segment--active');
      this.activeIndex = nextIndex;
      this.rowAt(this.activeIndex)?.classList.add('segment--active');
      if (this.state.followPlayback) this.scrollToActiveSegment();
    }
  };

  private rowAt(index: number): HTMLButtonElement | null {
    return this.root?.querySelector<HTMLButtonElement>(`[data-segment-index="${index}"]`) ?? null;
  }

  private scrollToActiveSegment(): boolean {
    const row = this.rowAt(this.activeIndex);
    const scroller = this.root?.querySelector<HTMLElement>('.transcript');
    if (!row || !scroller) return false;
    const top = Math.max(0, row.offsetTop - (scroller.clientHeight - row.offsetHeight) / 2);
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: 'smooth' });
    else scroller.scrollTop = top;
    return true;
  }

  private toggleFollowPlayback = (): void => {
    this.state = { ...this.state, followPlayback: !this.state.followPlayback };
    const button = this.root?.querySelector<HTMLButtonElement>('[data-action="follow-playback"]');
    if (button) {
      const label = this.state.followPlayback ? 'Tắt tự theo dõi' : 'Bật tự theo dõi';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(this.state.followPlayback));
      button.classList.toggle('icon-button--active', this.state.followPlayback);
    }
    if (this.state.followPlayback) {
      this.bindVideo();
      const previousIndex = this.activeIndex;
      this.syncActiveSegment();
      if (previousIndex === this.activeIndex) this.scrollToActiveSegment();
    }
  };

  private jumpToCurrentTime = (): void => {
    const segments = this.state.transcript?.segments;
    this.bindVideo();
    if (!segments?.length || !this.video || this.video.readyState < HTMLMediaElement.HAVE_METADATA) {
      this.setFeedback('Video chưa sẵn sàng để xác định thời điểm hiện tại.', 'error');
      return;
    }
    const previousIndex = this.activeIndex;
    this.syncActiveSegment();
    const followedNewSegment = this.state.followPlayback && previousIndex !== this.activeIndex;
    if (!followedNewSegment && !this.scrollToActiveSegment()) {
      this.setFeedback('Không tìm thấy đoạn transcript tại thời điểm hiện tại.', 'error');
      return;
    }
  };

  private copyTranscript = (): void => {
    const segments = this.state.transcript?.segments;
    if (!segments) return;
    const text = formatTranscript(segments, this.state.outputMode);
    void copyTranscriptText(text)
      .then(() => this.setFeedback('Đã sao chép toàn bộ transcript.', 'info'))
      .catch(() => this.setFeedback('Không thể sao chép transcript.', 'error'));
  };

  private downloadTranscript = (): void => {
    const { context, selectedTrack, transcript } = this.state;
    if (!context || !selectedTrack || !transcript) return;
    try {
      downloadTranscriptText(formatTranscript(transcript.segments, this.state.outputMode), context.title, selectedTrack.languageCode);
      this.setFeedback('Đã bắt đầu tải file .txt.', 'info');
    } catch {
      this.setFeedback('Không thể tải transcript.', 'error');
    }
  };

  private seekToSegment(segment: TranscriptSegment): void {
    this.bindVideo();
    if (!this.video || this.video.readyState < HTMLMediaElement.HAVE_METADATA) {
      this.setFeedback('Video chưa sẵn sàng để chuyển thời điểm.', 'error');
      return;
    }
    this.video.currentTime = segment.startMs / 1_000;
    this.syncActiveSegment();
  }

  private render(): void {
    if (!this.root) return;
    const savedScrollTop = this.root.querySelector<HTMLElement>('.transcript')?.scrollTop ?? 0;
    const style = document.createElement('style');
    style.textContent = panelCss;
    const card = document.createElement('section');
    card.className = 'card';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'header';
    header.setAttribute('aria-expanded', String(this.state.expanded));
    header.title = this.state.expanded ? 'Thu gọn transcript' : 'Mở transcript';
    header.addEventListener('click', this.toggleExpanded);
    const logo = document.createElement('img');
    logo.className = 'logo';
    logo.src = chrome.runtime.getURL('icon/32.png');
    logo.alt = '';
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.textContent = 'EzSubtitle';
    const chevron = createIcon('m6 9 6 6 6-6');
    chevron.classList.add('chevron');
    if (this.state.expanded) chevron.classList.add('chevron--expanded');
    header.append(logo, brand, chevron);
    card.append(header);

    if (this.state.expanded) card.append(this.renderBody());
    this.root.replaceChildren(style, card);
    const scroller = this.root.querySelector<HTMLElement>('.transcript');
    if (scroller) scroller.scrollTop = savedScrollTop;
  }

  private renderBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'body';
    const hasTranscript = Boolean(this.state.transcript);
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const controls = document.createElement('div');
    controls.className = 'controls';
    const language = document.createElement('label');
    language.className = 'field';
    const languageLabel = document.createElement('span');
    languageLabel.textContent = 'Phụ đề';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Ngôn ngữ phụ đề');
    select.disabled = this.state.loading || !this.state.context;
    for (const track of this.state.context?.tracks ?? []) {
      const option = document.createElement('option');
      option.value = track.id;
      option.selected = track.id === this.state.selectedTrack?.id;
      option.textContent = captionTrackDisplayLabel(track);
      select.append(option);
    }
    select.addEventListener('change', () => {
      const context = this.state.context;
      const track = context?.tracks.find((candidate) => candidate.id === select.value);
      if (context && track) void this.loadTrack(context, track);
    });
    language.append(languageLabel, select);
    const output = document.createElement('label');
    output.className = 'field';
    const outputLabel = document.createElement('span');
    outputLabel.textContent = 'Xuất';
    const outputSelect = document.createElement('select');
    outputSelect.setAttribute('aria-label', 'Định dạng xuất transcript');
    for (const [value, label] of [['readable', 'Dễ đọc'], ['detailed', 'Chi tiết']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === this.state.outputMode;
      outputSelect.append(option);
    }
    outputSelect.addEventListener('change', () => {
      const mode = outputSelect.value as TranscriptOutputMode;
      this.state = { ...this.state, outputMode: mode };
      void storeOutputFormat(mode).catch(() => this.setFeedback('Không thể lưu định dạng xuất.', 'error'));
    });
    output.append(outputLabel, outputSelect);
    controls.append(language, output);
    const tools = document.createElement('div');
    tools.className = 'tools';
    const followButton = createIconButton(
      this.state.followPlayback ? 'Tắt tự theo dõi' : 'Bật tự theo dõi',
      'M12 3v3m0 12v3M3 12h3m12 0h3m-6 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
      !hasTranscript,
      this.toggleFollowPlayback,
      this.state.followPlayback,
    );
    followButton.dataset.action = 'follow-playback';
    tools.append(
      followButton,
      createIconButton('Đi tới thời điểm hiện tại', 'M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', !hasTranscript, this.jumpToCurrentTime),
      createIconButton('Sao chép transcript', 'M8 8h10v12H8z M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1', !hasTranscript, this.copyTranscript),
      createIconButton('Tải transcript .txt', 'M12 3v12m0 0 4-4m-4 4-4-4 M5 20h14', !hasTranscript, this.downloadTranscript),
    );
    toolbar.append(controls, tools);
    body.append(toolbar);

    if (this.state.feedback) {
      const feedback = document.createElement('div');
      feedback.className = `feedback${this.state.feedback.kind === 'error' ? ' feedback--error' : ''}`;
      feedback.setAttribute('role', 'status');
      feedback.textContent = this.state.feedback.message;
      body.append(feedback);
    }
    if (this.state.loading) {
      const loading = document.createElement('div');
      loading.className = 'status';
      loading.setAttribute('role', 'status');
      loading.textContent = 'Đang tải transcript...';
      body.append(loading);
      return body;
    }
    if (this.state.error) {
      const error = document.createElement('div');
      error.className = 'status status--error';
      error.setAttribute('role', 'alert');
      error.textContent = this.state.error;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'retry';
      retry.textContent = 'Thử lại';
      retry.addEventListener('click', () => void this.loadContext());
      error.append(retry);
      body.append(error);
      return body;
    }
    if (!this.state.transcript) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Mở panel để tải transcript của video này.';
      body.append(empty);
      return body;
    }

    const transcript = document.createElement('div');
    transcript.className = 'transcript';
    transcript.setAttribute('aria-label', 'Transcript có timestamp');
    this.state.transcript.segments.forEach((segment, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `segment${index === this.activeIndex ? ' segment--active' : ''}`;
      row.dataset.segmentIndex = String(index);
      row.title = `Chuyển video tới ${formatTimestamp(segment.startMs)}`;
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = formatTimestamp(segment.startMs);
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = segment.text;
      row.append(time, text);
      row.addEventListener('click', () => this.seekToSegment(segment));
      transcript.append(row);
    });
    body.append(transcript);
    return body;
  }
}
