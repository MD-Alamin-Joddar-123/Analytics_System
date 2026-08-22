import { eventProcessingService } from '../../src/services/event/eventProcessing.service.js';

// Phase 7 split ingestion (POST /api/collect) from processing (the
// worker). Most Phase 5/6 tests were written against the old synchronous
// pipeline — they POST an event and immediately assert on the resulting
// Visitor/Session/Product/Cart/Order documents. To keep exercising that
// same business logic (unchanged — only WHEN it runs moved), this helper
// POSTs the event and then directly invokes the same processing function
// the worker calls, synchronously "playing the worker's part" within the
// test, using the mock pipeline's `events` store to find which Event
// document was just created/matched.
export async function postAndProcess(baseUrl, body, pipeline) {
  const res = await fetch(`${baseUrl}/api/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json();

  let processingResult = null;
  const eventId = responseBody?.data?.eventId;
  if (eventId) {
    const key = `${body.websiteId}:${eventId}`;
    const eventDoc = pipeline.events.get(key);
    if (eventDoc) {
      processingResult = await eventProcessingService.processEvent(eventDoc._id);
    }
  }

  return { res, body: responseBody, processingResult };
}
