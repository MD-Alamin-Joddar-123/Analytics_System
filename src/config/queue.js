import { env } from './env.js';

// Generic enough for future job types (§37: analytics aggregation, daily
// stats, cleanup jobs, ...) — nothing here is specific to event
// processing. The event queue (src/queues/event.queue.js) is the first
// consumer of these defaults, not the only one this shape supports.

export const EVENT_QUEUE_NAME = 'analytics-events';

export const defaultJobOptions = {
  // Configurable via env, not hard-coded (§9/§32).
  attempts: env.queueAttempts,
  backoff: {
    type: 'exponential',
    delay: env.queueBackoffDelayMs,
  },
  // Bounded retention of successful jobs — just enough recent history to
  // be useful for debugging, not an unbounded log.
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  // Failed jobs are kept indefinitely by default (§10: "do not silently
  // discard failed events" / "do not delete failed jobs immediately") —
  // they accumulate in Redis as a de facto dead-letter list until an
  // operator or a future cleanup job (§37) removes them.
  removeOnFail: false,
};

// Deterministic per-event jobId (§16): the queue itself — not just an
// application-level pre-check — refuses to create a second job for the
// same (websiteId, eventId), because BullMQ treats adding a job with an
// already-existing jobId as a no-op rather than creating a duplicate.
//
// NOT a colon-delimited join: BullMQ's Job.validateOptions rejects any
// custom jobId that contains exactly one ":" (reserved for its own
// internal repeatable-job id format, which uses exactly two) — see
// node_modules/bullmq/dist/cjs/classes/job.js. A previous version of this
// function used `${websiteId}:${eventId}`, which produces exactly one and
// was therefore rejected on EVERY real call, unconditionally — with the
// queue itself always mocked in tests, nothing here ever exercised real
// BullMQ job-id validation, so this went undetected until a real
// (unmocked) queue actually tried to add a job. Uniqueness doesn't depend
// on the delimiter itself being unambiguous — websiteId is always a fixed
// 16-character id (see utils/websiteId.js), so the boundary is
// unambiguous regardless of what eventId contains.
export function buildEventJobId(websiteId, eventId) {
  return `${websiteId}_${eventId}`;
}
