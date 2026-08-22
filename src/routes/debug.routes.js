import { Router } from 'express';
import { Queue } from 'bullmq';
import { getRedisConnection } from '../config/redis.js';
import { EVENT_QUEUE_NAME, defaultJobOptions } from '../config/queue.js';

// TEMPORARY diagnostic route — added solely to get a real error object back
// over HTTP when server logs weren't surfacing it, for debugging why BullMQ
// .add() fails against a Redis connection that PINGs fine. No secrets, no
// writes beyond a throwaway queue job (auto-removed). DELETE THIS FILE and
// its registration in routes/index.js once the Redis/queue issue is
// resolved — it should never ship long-term.
const router = Router();

function serializeError(error) {
  return {
    message: error?.message,
    name: error?.name,
    code: error?.code,
    stack: typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 8) : undefined,
  };
}

router.get('/redis-eval', async (req, res) => {
  try {
    const result = await getRedisConnection().eval('return 1', 0);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: serializeError(error) });
  }
});

router.get('/queue-add', async (req, res) => {
  // Deliberately bypasses eventQueueService.enqueueEventProcessing, which
  // wraps whatever .add() throws into a generic ApiError (only
  // error.message survives, no name/code/stack) before it ever reaches a
  // log line — that wrapping is exactly what's been hiding the real cause.
  // This talks to BullMQ directly so the RAW error comes back untouched.
  try {
    const debugQueue = new Queue(EVENT_QUEUE_NAME, { connection: getRedisConnection(), defaultJobOptions });
    const job = await debugQueue.add('process-event', { debug: true }, { jobId: `debug-${Date.now()}` });
    res.json({ success: true, jobId: job.id });
  } catch (error) {
    res.status(500).json({ success: false, error: serializeError(error) });
  }
});

export default router;
