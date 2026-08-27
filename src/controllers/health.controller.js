import { getDatabaseState } from '../config/database.js';
import { eventQueueService } from '../queues/event.queue.js';

export async function getHealth(req, res, next) {
  try {
    const databaseState = getDatabaseState();
    const queueState = await eventQueueService.checkHealth();
    const redisState = queueState === 'ready' ? 'connected' : 'disconnected';

    const isHealthy = databaseState === 'connected' && queueState === 'ready';

    res.status(isHealthy ? 200 : 503).json({
      success: true,
      status: isHealthy ? 'healthy' : 'degraded',
      database: databaseState,
      redis: redisState,
      queue: queueState,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}
