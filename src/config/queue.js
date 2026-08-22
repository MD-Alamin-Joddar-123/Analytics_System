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
export function buildEventJobId(websiteId, eventId) {
  return `${websiteId}:${eventId}`;
}
