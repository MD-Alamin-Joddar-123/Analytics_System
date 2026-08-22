import { pathToFileURL } from 'node:url';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { getRedisConnectionOptions, disconnectRedis } from '../config/redis.js';
import { EVENT_QUEUE_NAME } from '../config/queue.js';
import { eventProcessingService } from '../services/event/eventProcessing.service.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

// The worker gets its OWN Redis connection, separate from
// config/redis.js's shared one (which is for the API process's queue
// producer + health checks). This is both a process boundary (the worker
// is meant to run as `node src/workers/event.worker.js`, a different OS
// process from the API server — §19) and a BullMQ requirement: a Worker
// issues blocking reads against Redis and should not share a connection
// used for other, non-blocking purposes.
function createWorkerRedisConnection() {
  return new Redis(env.redisUrl, getRedisConnectionOptions());
}

// Thin BullMQ adapter (§6): all actual business logic lives in
// eventProcessingService, which has no BullMQ/Redis dependency of its own
// and is unit-testable in isolation. This function only translates a
// BullMQ job into a call to that service and structures the resulting
// logs — it makes no database queries and no service-layer decisions
// itself.
export function createEventWorker() {
  const connection = createWorkerRedisConnection();

  const worker = new Worker(
    EVENT_QUEUE_NAME,
    async (job) => {
      const { eventObjectId } = job.data;
      return eventProcessingService.processEvent(eventObjectId);
    },
    {
      connection,
      concurrency: env.workerConcurrency,
    }
  );

  worker.on('completed', (job, result) => {
    logger.info('worker_job_completed', {
      jobId: job.id,
      eventObjectId: job.data?.eventObjectId,
      websiteId: job.data?.websiteId,
      eventId: job.data?.eventId,
      result,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('worker_job_failed', {
      jobId: job?.id,
      eventObjectId: job?.data?.eventObjectId,
      websiteId: job?.data?.websiteId,
      eventId: job?.data?.eventId,
      attemptsMade: job?.attemptsMade,
      willRetry: job ? job.attemptsMade < (job.opts?.attempts ?? 1) : false,
      errorMessage: error.message,
    });
  });

  worker.on('error', (error) => {
    logger.error('worker_error', { message: error.message });
  });

  return { worker, connection };
}

async function start() {
  try {
    await connectDatabase();
  } catch (error) {
    logger.error('worker_startup_aborted_database_failed', { message: error.message });
    process.exit(1);
  }

  const { worker, connection } = createEventWorker();
  logger.info('Worker started', { queue: EVENT_QUEUE_NAME, concurrency: env.workerConcurrency });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Worker shutdown signal received', { signal });

    // §18: stop accepting new jobs, let active ones finish where
    // practical — but don't wait forever. worker.close() resolves once
    // in-flight jobs complete; force-close if that takes too long.
    const closed = await Promise.race([
      worker.close().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), SHUTDOWN_TIMEOUT_MS)),
    ]);

    if (!closed) {
      logger.warn('Worker graceful close timed out, forcing shutdown', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
      await worker.close(true).catch(() => {});
    }

    await connection.quit().catch(() => connection.disconnect());
    await disconnectRedis();
    await disconnectDatabase();
    logger.info('Worker shut down gracefully');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Worker unhandled promise rejection', { message: reason?.message || String(reason) });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Worker uncaught exception', { message: error.message });
    process.exit(1);
  });
}

// Only run when executed directly (`node src/workers/event.worker.js` /
// `npm run worker`), never when imported by tests (§20: worker startup is
// explicit, never silently started as a side effect of importing this
// module from the API process or a test file).
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  start();
}
