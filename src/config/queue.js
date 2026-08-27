import { env } from './env.js';


export const EVENT_QUEUE_NAME = 'analytics-events';

export const defaultJobOptions = {
  attempts: env.queueAttempts,
  backoff: {
    type: 'exponential',
    delay: env.queueBackoffDelayMs,
  },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: false,
};

export function buildEventJobId(websiteId, eventId) {
  return `${websiteId}_${eventId}`;
}
