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

  let embeddedWorker = null;
  if (env.embedWorker) {
    embeddedWorker = createEventWorker();
    logger.info('Event worker started in-process (EMBED_WORKER=true)', {
      concurrency: env.workerConcurrency,
    });
  }

  const shutdown = async (signal) => {
    logger.info('Shutdown signal received', { signal });
    server.close(async () => {
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
