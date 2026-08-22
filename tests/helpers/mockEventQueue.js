import { eventQueueService } from '../../src/queues/event.queue.js';

// Lightweight, stateless pass-through mock: every enqueue call "succeeds"
// without ever touching real Redis/BullMQ. Sufficient for any test that
// only needs event.service.js's ingestion path to complete normally (most
// of them) — tests that specifically exercise queue behavior (job
// creation, deterministic jobId, duplicate prevention, retry/backoff
// configuration, enqueue failure handling) use a fuller fake queue
// instead (tests/helpers/fakeEventQueue.js).
export function mockEventQueueSuccess(t) {
  t.mock.method(eventQueueService, 'enqueueEventProcessing', async ({ websiteId, eventId }) => ({
    id: `${websiteId}:${eventId}`,
  }));
}
