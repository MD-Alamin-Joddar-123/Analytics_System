import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { disconnectRedis } from '../src/config/redis.js';
import { disconnectDatabase } from '../src/config/database.js';
import { eventQueueService } from '../src/queues/event.queue.js';

describe('Graceful shutdown — safe no-op behavior', () => {
  test('disconnectRedis() resolves cleanly when no Redis client was ever constructed', async () => {
    await assert.doesNotReject(() => disconnectRedis());
  });

  test('disconnectRedis() is safe to call multiple times in a row', async () => {
    await assert.doesNotReject(async () => {
      await disconnectRedis();
      await disconnectRedis();
      await disconnectRedis();
    });
  });

  test('eventQueueService.close() resolves cleanly when no queue was ever constructed', async () => {
    await assert.doesNotReject(() => eventQueueService.close());
  });

  test('eventQueueService.close() is safe to call multiple times in a row', async () => {
    await assert.doesNotReject(async () => {
      await eventQueueService.close();
      await eventQueueService.close();
    });
  });

  test('disconnectDatabase() resolves cleanly when never connected', async () => {
    await assert.doesNotReject(() => disconnectDatabase());
  });
});
