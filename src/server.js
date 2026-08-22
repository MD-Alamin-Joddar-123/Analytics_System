import { env } from './config/env.js';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis } from './config/redis.js';
import { eventQueueService } from './queues/event.queue.js';
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
