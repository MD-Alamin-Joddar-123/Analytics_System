// Deterministic UTC time-bucket math (Phase 8 §5/§30/§31). Pure functions,
// no I/O — the bucket for a given timestamp is always computed the same
// way regardless of when aggregation actually runs, which is what makes a
// future backfill/reprocessing job (§32) safe: re-running aggregateEvent
// for an old event produces the exact same bucket it would have at the
// time, never "today's" bucket.
//
// Canonical rule (§31, late events): the bucket is derived from the
// EVENT's own timestamp (Event.timestamp — the client-reported/effective
// event time), never receivedAt. An event that occurred at 14:58 but
// wasn't received/processed until 15:03 still lands in the 14:00 hour
// bucket and the same day bucket — exactly as if it had been processed
// instantly. This is deliberate: receivedAt reflects server/queue timing
// noise (network latency, retry backoff, worker backlog), not anything
// about when the visitor actually acted.
function getHourBucket(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0));
}

function getDayBucket(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

const BUCKET_FNS = {
  hour: getHourBucket,
  day: getDayBucket,
};

// Extending to 'week'/'month' later (§5) means adding one function here and
// one entry to SUPPORTED_GRANULARITIES — no change to any caller, model, or
// the idempotency/uniqueness strategy, all of which are granularity-agnostic.
export function getBucket(date, granularity) {
  const fn = BUCKET_FNS[granularity];
  if (!fn) {
    throw new Error(`Unsupported analytics granularity: ${granularity}`);
  }
  return fn(date);
}
