import { Queue } from 'bullmq';
import { getRedisConnection, checkRedisHealth } from '../config/redis.js';
import { EVENT_QUEUE_NAME, defaultJobOptions, buildEventJobId } from '../config/queue.js';
import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { logger } from '../utils/logger.js';

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

function resetEventQueue() {
  queue = null;
}

export const eventQueueService = {
  async enqueueEventProcessing({ eventObjectId, websiteId, eventId }) {
    const jobId = buildEventJobId(websiteId, eventId);
    try {
      return await getEventQueue().add(
        'process-event',
        { eventObjectId: String(eventObjectId), websiteId, eventId },
        { jobId }
      );
    } catch (error) {
      logger.error('event_queue_enqueue_failed', {
        websiteId,
        eventId,
        message: error.message,
        name: error.name,
        code: error.code,
        stack: typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 5) : undefined,
      });
      resetEventQueue();
      throw ApiError.serviceUnavailable(
        'Event was recorded but could not be queued for processing.',
        ErrorCodes.QUEUE_UNAVAILABLE
      );
    }
  },

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
