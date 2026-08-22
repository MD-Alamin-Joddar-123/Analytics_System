// Time-bucket granularities the aggregation engine currently writes (Phase
// 8 §5). Every aggregation model's `granularity` enum, and every service
// that iterates "which buckets does this event belong to", reads from this
// one list — adding 'week'/'month' later is a one-line change here plus
// (optionally) a getBucket() case in analyticsBucket.service.js, not a
// redesign of the aggregation collections or the idempotency/uniqueness
// strategy, which are granularity-agnostic by construction.
export const SUPPORTED_GRANULARITIES = Object.freeze(['hour', 'day']);
