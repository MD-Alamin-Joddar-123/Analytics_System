const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function parseEventTimestamp(value) {
  if (value === undefined || value === null) return { ok: true, date: null };

  if (typeof value !== 'string' && typeof value !== 'number') {
    return { ok: false, date: null };
  }

  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) {
    return { ok: false, date: null };
  }

  const date = new Date(ms);
  if (date.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    return { ok: false, date: null };
  }

  return { ok: true, date };
}
