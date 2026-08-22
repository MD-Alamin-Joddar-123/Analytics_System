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
      logger.error('event_queue_enqueue_failed', {
        websiteId,
        eventId,
        message: error.message,
      });
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
