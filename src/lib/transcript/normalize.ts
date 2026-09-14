const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeEntity(match: string, entity: string): string {
  const named = NAMED_ENTITIES[entity.toLowerCase()];
  if (named) return named;
  const numeric = entity.startsWith('#x') || entity.startsWith('#X')
    ? Number.parseInt(entity.slice(2), 16)
    : entity.startsWith('#') ? Number.parseInt(entity.slice(1), 10) : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) return match;
  try {
    return String.fromCodePoint(numeric);
  } catch {
    return match;
  }
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity);
}

export function normalizeCaptionText(value: string): string {
  return decodeEntities(value).replace(/\r\n?/g, '\n').replace(/[\t\n\f\r ]+/g, ' ').trim();
}

export function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
