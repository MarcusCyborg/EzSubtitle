export type TranscriptTrackSelector = {
  id: string;
  languageCode: string;
  label: string;
};

export type TranscriptEndpointCandidate = {
  params: string;
  languageCode: string | null;
  label: string | null;
  vssId: string | null;
  selected: boolean;
};

export type TranscriptEndpointInspection = {
  endpoints: TranscriptEndpointCandidate[];
  selectedTracks: Omit<TranscriptEndpointCandidate, 'params'>[];
};

type RecordValue = Record<string, unknown>;

const MAX_DEPTH = 40;
const MAX_NODES = 50_000;
const MAX_ARRAY_ITEMS = 10_000;
const MAX_PARAMS_LENGTH = 8_000;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isTranscriptEndpointParams(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 16
    && value.length <= MAX_PARAMS_LENGTH
    && /^[A-Za-z0-9_%=-]+$/.test(value);
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() && value.length <= 200) return value.trim();
  if (!isRecord(value)) return null;
  if (typeof value.simpleText === 'string' && value.simpleText.trim() && value.simpleText.length <= 200) {
    return value.simpleText.trim();
  }
  if (!Array.isArray(value.runs) || value.runs.length > 20) return null;
  const text = value.runs.map((run) => isRecord(run) && typeof run.text === 'string' ? run.text : '').join('').trim();
  return text && text.length <= 200 ? text : null;
}

type TrackMetadata = {
  languageCode: string | null;
  label: string | null;
  vssId: string | null;
  selected: boolean;
};

const emptyMetadata = (): TrackMetadata => ({ languageCode: null, label: null, vssId: null, selected: false });

function metadataFromRecord(value: RecordValue): Partial<TrackMetadata> {
  const languageCode = typeof value.languageCode === 'string' && /^[A-Za-z0-9-]{2,35}$/.test(value.languageCode)
    ? value.languageCode
    : typeof value.lang === 'string' && /^[A-Za-z0-9-]{2,35}$/.test(value.lang) ? value.lang : null;
  const vssId = typeof value.vssId === 'string' && value.vssId.length <= 100 ? value.vssId : null;
  const label = textValue(value.label) ?? textValue(value.title) ?? textValue(value.name);
  return {
    ...(languageCode ? { languageCode } : {}),
    ...(vssId ? { vssId } : {}),
    ...(label ? { label } : {}),
    ...(value.selected === true ? { selected: true } : {}),
  };
}

function mergeMetadata(parent: TrackMetadata, current: Partial<TrackMetadata>): TrackMetadata {
  return {
    languageCode: current.languageCode ?? parent.languageCode,
    label: current.label ?? parent.label,
    vssId: current.vssId ?? parent.vssId,
    selected: current.selected ?? parent.selected,
  };
}

function commandTargetsTranscript(value: RecordValue): boolean {
  const metadata = value.commandMetadata;
  if (!isRecord(metadata) || !isRecord(metadata.webCommandMetadata)) return true;
  const apiUrl = metadata.webCommandMetadata.apiUrl;
  return typeof apiUrl !== 'string' || apiUrl === '/youtubei/v1/get_transcript';
}

function directEndpointParams(value: RecordValue): string | null {
  if (isRecord(value.getTranscriptEndpoint) && isTranscriptEndpointParams(value.getTranscriptEndpoint.params)) {
    return commandTargetsTranscript(value) ? value.getTranscriptEndpoint.params : null;
  }
  if (isRecord(value.reloadContinuationData) && isTranscriptEndpointParams(value.reloadContinuationData.continuation)) {
    return value.reloadContinuationData.continuation;
  }
  if (isRecord(value.continuationCommand)
    && isTranscriptEndpointParams(value.continuationCommand.token)
    && commandTargetsTranscript(value)) {
    return value.continuationCommand.token;
  }
  return null;
}

/** Walks bounded page/response data without copying it across the extension bridge. */
export function inspectTranscriptEndpoints(root: unknown): TranscriptEndpointInspection {
  const endpoints: TranscriptEndpointCandidate[] = [];
  const selectedTracks: TranscriptEndpointInspection['selectedTracks'] = [];
  const seenObjects = new WeakSet<object>();
  const seenParams = new Set<string>();
  const stack: Array<{ value: unknown; metadata: TrackMetadata; depth: number }> = [
    { value: root, metadata: emptyMetadata(), depth: 0 },
  ];
  let visited = 0;

  while (stack.length && visited < MAX_NODES) {
    const item = stack.pop();
    if (!item || item.depth > MAX_DEPTH) continue;
    const { value, depth } = item;
    if (Array.isArray(value)) {
      if (seenObjects.has(value)) continue;
      seenObjects.add(value);
      visited += 1;
      const limit = Math.min(value.length, MAX_ARRAY_ITEMS);
      for (let index = limit - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], metadata: item.metadata, depth: depth + 1 });
      }
      continue;
    }
    if (!isRecord(value) || seenObjects.has(value)) continue;
    seenObjects.add(value);
    visited += 1;

    const metadata = mergeMetadata(item.metadata, metadataFromRecord(value));
    if (value.selected === true && (metadata.languageCode || metadata.label || metadata.vssId)) {
      selectedTracks.push({ ...metadata });
    }
    const params = directEndpointParams(value);
    if (params && !seenParams.has(params)) {
      seenParams.add(params);
      endpoints.push({ params, ...metadata });
    }

    for (const child of Object.values(value)) {
      stack.push({ value: child, metadata, depth: depth + 1 });
    }
  }
  return { endpoints, selectedTracks };
}

function normalized(value: string | null): string {
  return (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizedTrackId(value: string | null): string {
  return normalized(value).replace(/^(a|asr) /, '');
}

export function trackMatchScore(candidate: TrackMetadata, track: TranscriptTrackSelector): number {
  const requestedLanguage = normalized(track.languageCode);
  const candidateLanguage = normalized(candidate.languageCode);
  const requestedLabel = normalized(track.label);
  const candidateLabel = normalized(candidate.label);
  const requestedId = normalizedTrackId(track.id);
  const candidateId = normalizedTrackId(candidate.vssId);
  let score = 0;
  if (candidateLanguage && candidateLanguage === requestedLanguage) score += 8;
  else if (candidateLanguage && (candidateLanguage.startsWith(`${requestedLanguage} `) || requestedLanguage.startsWith(`${candidateLanguage} `))) score += 5;
  if (candidateId && candidateId === requestedId) score += 10;
  if (candidateLabel && requestedLabel && candidateLabel === requestedLabel) score += 6;
  else if (candidateLabel && requestedLabel && (candidateLabel.includes(requestedLabel) || requestedLabel.includes(candidateLabel))) score += 3;
  return score;
}

export function responseMatchesTrack(inspection: TranscriptEndpointInspection, track: TranscriptTrackSelector): boolean {
  return inspection.selectedTracks.some((candidate) => trackMatchScore(candidate, track) >= 5)
    || inspection.endpoints.some((candidate) => candidate.selected && trackMatchScore(candidate, track) >= 5);
}

export function endpointForTrack(
  inspection: TranscriptEndpointInspection,
  track: TranscriptTrackSelector,
): TranscriptEndpointCandidate | null {
  const ranked = inspection.endpoints
    .map((candidate) => ({ candidate, score: trackMatchScore(candidate, track) }))
    .filter(({ score }) => score >= 5)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.candidate ?? null;
}
