import { Queue } from 'bullmq';
import { getRedisConnection, checkRedisHealth } from '../config/redis.js';
import { EVENT_QUEUE_NAME, defaultJobOptions, buildEventJobId } from '../config/queue.js';
import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { logger } from '../utils/logger.js';

// Lazily constructed — importing this module must never itself attempt a
// Redis connection (mirrors config/redis.js's own laziness), which is what
// lets tests mock `eventQueueService.enqueueEventProcessing` directly
// without ever touching real infrastructure.
let queue = null;

function getEventQueue() {
  if (!queue) {
    queue = new Queue(EVENT_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions,
    });
  }
  return queue;
}

// Discards the cached Queue object WITHOUT attempting a graceful close — a
// Queue that just failed may itself be in a broken state where .close()
// would hang or throw, which would only compound the problem from inside
// an error path. The next getEventQueue() call simply builds a fresh
// object against the SAME shared Redis connection (config/redis.js's own
// singleton is unaffected by this).
//
// This exists because of a real, observed failure mode: this module's
// `queue` singleton is constructed once, lazily, the first time anything
// ever enqueues a job on this process — if THAT happened to run during a
// transient Redis outage, the resulting Queue object could end up
// permanently wedged even after the underlying connection fully recovered,
// because nothing ever gave that specific object a reason to retry its own
// internal setup. A fresh Queue built against a now-healthy connection
// worked immediately where the stale one kept failing — this makes that
// recovery automatic instead of requiring a manual process restart.
function resetEventQueue() {
  queue = null;
}

export const eventQueueService = {
  // Job data is a stable REFERENCE to the persisted Event document, not a
  // copy of the event payload (§5) — keeps Redis payload size small and
  // means the worker always reads the current, authoritative document
  // rather than a possibly-stale snapshot.
  //
  // Job-level deduplication is deterministic (§16, see buildEventJobId):
  // re-enqueuing the same websiteId+eventId is a safe no-op at the queue
  // layer, which is why the ingestion service (event.service.js) can call
  // this again for a duplicate-event resubmission without first checking
  // whether a job already exists.
  async enqueueEventProcessing({ eventObjectId, websiteId, eventId }) {
    const jobId = buildEventJobId(websiteId, eventId);
    try {
      return await getEventQueue().add(
        'process-event',
        { eventObjectId: String(eventObjectId), websiteId, eventId },
        { jobId }
      );
    } catch (error) {
      // §21: never pretend a job was queued when it wasn't. The caller
      // (event.service.js) decides what this means for the HTTP response;
      // this layer's job is just to fail loudly rather than swallow it.
      // name/code/a short stack preview (not just message) — a generic
      // message alone previously made a real, root-cause-able failure
      // indistinguishable from "Redis is just down".
      logger.error('event_queue_enqueue_failed', {
        websiteId,
        eventId,
        message: error.message,
        name: error.name,
        code: error.code,
        stack: typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 5) : undefined,
      });
      // Self-healing — see resetEventQueue's own comment for the exact
      // failure mode this recovers from.
      resetEventQueue();
      throw ApiError.serviceUnavailable(
        'Event was recorded but could not be queued for processing.',
        ErrorCodes.QUEUE_UNAVAILABLE
      );
    }
  },

  // Queue readiness is defined in terms of Redis reachability, since a
  // BullMQ Queue has no meaningful "ready" state independent of its
  // connection — deliberately avoids a separate probe that could hang
  // (e.g. awaiting BullMQ's own `.client` promise with no timeout).
  async checkHealth() {
    const redisStatus = await checkRedisHealth();
    return redisStatus === 'connected' ? 'ready' : 'unavailable';
  },

  async close() {
    if (queue) {
      await queue.close();
      queue = null;
    }
  },
};
