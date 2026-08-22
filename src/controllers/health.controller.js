import { getDatabaseState } from '../config/database.js';
import { eventQueueService } from '../queues/event.queue.js';

// Phase 7 §26: distinguishes MongoDB, Redis, and queue readiness. Overall
// `status` is "healthy" only when every dependency the collector actually
// needs is available — Redis/queue included, since POST /api/collect now
// depends on successfully enqueueing a job (§21: it returns an error
// rather than a false success when it can't). A Redis outage is therefore
// a real degradation of this system, not a cosmetic one.
export async function getHealth(req, res, next) {
  try {
    const databaseState = getDatabaseState();
    // checkHealth() never throws — see eventQueueService — but the
    // try/catch here stays as defense-in-depth, consistent with the rest
    // of the codebase's error handling.
    const queueState = await eventQueueService.checkHealth(); // 'ready' | 'unavailable'
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
