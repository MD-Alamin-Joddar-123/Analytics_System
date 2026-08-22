// Tolerance for clock skew between a client device and this server. A
// client-supplied timestamp further in the future than this is treated as
// invalid rather than trusted outright — never assume the client clock is
// correct, but don't demand perfect synchronization either.
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

// No lower bound: an arbitrarily old timestamp is accepted (e.g. an SDK
// replaying events queued while the browser was offline), since rejecting
// old-but-genuine data would silently lose real events.
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
