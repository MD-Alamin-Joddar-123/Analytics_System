import { env } from './config/env.js';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis } from './config/redis.js';
import { eventQueueService } from './queues/event.queue.js';
import { createEventWorker } from './workers/event.worker.js';
import { logger } from './utils/logger.js';

async function start() {
  try {
    await connectDatabase();
  } catch (error) {
    logger.error('Startup aborted: database connection failed', { message: error.message });
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(env.port, () => {
    logger.info('Server started', { port: env.port, env: env.nodeEnv });
  });

  // EMBED_WORKER=true runs the event worker INSIDE this API process rather
  // than as a separate `npm run start:worker` process. This exists for
  // hosting plans that don't offer a second always-on process (e.g.
  // Render's free tier, which has no Background Worker) — the pipeline
  // otherwise silently collects events that nothing ever processes.
  //
  // Deliberately opt-in, NOT the default: a separate worker process is
  // still the better deployment whenever it's available, because it
  // isolates failures (a worker crash can't take the API down with it),
  // scales independently, and doesn't compete with request handling for
  // CPU/memory. The worker's own module is imported and reused verbatim
  // here — this is a second way to START it, never a second copy of the
  // processing logic.
  //
  // Note for spin-down hosting (free tiers): when the service sleeps, the
  // embedded worker sleeps too. Queued jobs are NOT lost — they persist in
  // Redis and are picked up on the next wake, since the very request that
  // wakes the service also restarts this worker.
  let embeddedWorker = null;
  if (env.embedWorker) {
    embeddedWorker = createEventWorker();
    logger.info('Event worker started in-process (EMBED_WORKER=true)', {
      concurrency: env.workerConcurrency,
    });
  }

  // §18: on shutdown, stop accepting new HTTP connections first (this is
  // the API process — the event queue's PRODUCER side; the worker is a
  // separate process with its own shutdown sequence, see
  // src/workers/event.worker.js), let in-flight requests finish, then
  // close the queue and Redis connections this process opened, then
  // MongoDB, then exit. Order matters: closing Redis/the queue before the
  // HTTP server has stopped accepting requests could fail an in-flight
  // POST /api/collect that was about to enqueue a job.
  const shutdown = async (signal) => {
    logger.info('Shutdown signal received', { signal });
    server.close(async () => {
      // When embedded, the worker must be closed BEFORE the queue/Redis
      // connections it depends on — it may still be mid-job, and closing
      // Redis out from under it would fail that job rather than let it
      // finish. worker.close() waits for in-flight jobs; it's bounded here
      // so a stuck job can't block shutdown indefinitely (matching the
      // standalone worker's own SHUTDOWN_TIMEOUT_MS behavior).
      if (embeddedWorker) {
        await Promise.race([
          embeddedWorker.worker.close(),
          new Promise((resolve) => setTimeout(resolve, 30_000)),
        ]).catch(() => {});
        await embeddedWorker.connection.quit().catch(() => embeddedWorker.connection.disconnect());
      }
      await eventQueueService.close();
      await disconnectRedis();
      await disconnectDatabase();
      logger.info('Server shut down gracefully');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { message: reason?.message || String(reason) });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { message: error.message });
    process.exit(1);
  });

  return server;
}

start();
