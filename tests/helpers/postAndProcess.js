import { eventProcessingService } from '../../src/services/event/eventProcessing.service.js';

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
