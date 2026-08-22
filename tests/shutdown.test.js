import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { disconnectRedis } from '../src/config/redis.js';
import { disconnectDatabase } from '../src/config/database.js';
import { eventQueueService } from '../src/queues/event.queue.js';

// §18: graceful shutdown must close Redis, the queue, and MongoDB
// connections cleanly. The real end-to-end shutdown sequence (an actual
// SIGTERM against a running server/worker process with live Redis/MongoDB
// connections) is unverified in this sandbox — no Redis or MongoDB is
// available here (see final report). What IS safely testable, and
// genuinely meaningful given this environment, is that every shutdown
// function is idempotent and never throws when there is nothing to close
// — the exact condition this sandbox is actually in, and a real
// production scenario too (e.g. a second SIGTERM arriving before the
// first finishes, or a process that never successfully connected before
// being asked to shut down).
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
