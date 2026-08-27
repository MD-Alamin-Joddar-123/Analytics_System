import { eventQueueService } from '../../src/queues/event.queue.js';

export function mockEventQueueSuccess(t) {
  t.mock.method(eventQueueService, 'enqueueEventProcessing', async ({ websiteId, eventId }) => ({
    id: `${websiteId}:${eventId}`,
  }));
}
