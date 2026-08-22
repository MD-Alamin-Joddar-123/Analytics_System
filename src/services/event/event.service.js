import crypto from 'node:crypto';
import { websiteRepository } from '../../repositories/website.repository.js';
import { eventRepository } from '../../repositories/event.repository.js';
import { eventQueueService } from '../../queues/event.queue.js';
import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';

const DEFAULT_EVENT_VERSION = '1';

// Phase 7 §13 split: this file is now ingestion ONLY — validate (already
// done by the validator middleware) -> check website -> check idempotency
// -> persist -> enqueue -> respond. Visitor/Session resolution and
// Commerce dispatch (formerly synchronous here in Phase 4/5/6) now happen
// entirely in the worker — see src/services/event/eventProcessing.service.js
// and src/workers/event.worker.js. This function does not import or call
// any of the visitor/session/commerce services; it has no reason to.

async function resolveActiveWebsite(websiteId) {
  const website = await websiteRepository.findByWebsiteId(websiteId);

  if (!website) {
    throw ApiError.notFound('Website not found.', ErrorCodes.WEBSITE_NOT_FOUND);
  }

  if (website.status === 'archived') {
    throw ApiError.forbidden(
      'This website has been archived and is no longer accepting events.',
      ErrorCodes.WEBSITE_ARCHIVED
    );
  }

  // Paused websites reject events outright (rather than silently accepting
  // and flagging them) for clean semantics: a paused website has exactly
  // one behavior everywhere in the system — "not currently tracking" —
  // instead of a second, partially-tracked state that every downstream
  // consumer would need to know to filter out.
  if (website.status === 'paused') {
    throw ApiError.forbidden(
      'This website is paused and is not currently accepting events.',
      ErrorCodes.WEBSITE_PAUSED
    );
  }

  return website;
}

async function collectEvent(validated, context) {
  await resolveActiveWebsite(validated.websiteId);

  const eventId = validated.eventId ?? crypto.randomUUID();

  // §15: the same websiteId + eventId must never produce a second Event
  // document, regardless of how far the FIRST one got in processing. If
  // it hasn't reached `completed` yet, this resubmission is the client's
  // (or a retry proxy's) opportunity to make sure a processing job still
  // exists for it — enqueueing again is a safe no-op if one already does
  // (§16, deterministic jobId), and the worker's own completed-status
  // guard (eventProcessing.service.js) makes re-enqueueing an
  // already-completed event a cheap no-op too, so there's no need to
  // branch on processingStatus here at all.
  const existing = await eventRepository.findByWebsiteAndEventId(validated.websiteId, eventId);
  if (existing) {
    await eventQueueService.enqueueEventProcessing({
      eventObjectId: existing._id,
      websiteId: validated.websiteId,
      eventId,
    });
    return { accepted: true, duplicate: true, eventId };
  }

  const eventDoc = {
    websiteId: validated.websiteId,
    eventName: validated.event,
    eventVersion: validated.eventVersion ?? DEFAULT_EVENT_VERSION,
    eventId,
    // timestamp = when the event occurred (client-reported, defaulting to
    // receivedAt when absent). receivedAt = when THIS server accepted it,
    // always server-set. They differ whenever a client sends a queued/
    // batched event after the fact; they're equal when timestamp is
    // omitted.
    timestamp: validated.timestamp ?? context.receivedAt,
    receivedAt: context.receivedAt,
    url: validated.url,
    path: validated.path,
    title: validated.title,
    referrer: validated.referrer,
    anonymousId: validated.anonymousId,
    sessionId: validated.sessionId,
    // visitorId/sessionObjectId are intentionally NOT set here — Phase 7
    // resolves them asynchronously in the worker and fills them in when
    // processing completes (eventRepository.markProcessingCompleted).
    userAgent: context.userAgent,
    language: validated.language,
    screenWidth: validated.screenWidth,
    screenHeight: validated.screenHeight,
    timezone: validated.timezone,
    data: validated.data,
    processingStatus: 'pending',
    processingAttempts: 0,
  };

  let created;
  try {
    created = await eventRepository.create(eventDoc);
  } catch (error) {
    if (error.code === 11000) {
      // Lost a race with a concurrent duplicate submission (same
      // websiteId + eventId inserted between our existence check and this
      // write). Same handling as the `existing` branch above.
      const winner = await eventRepository.findByWebsiteAndEventId(validated.websiteId, eventId);
      if (winner) {
        await eventQueueService.enqueueEventProcessing({
          eventObjectId: winner._id,
          websiteId: validated.websiteId,
          eventId,
        });
        return { accepted: true, duplicate: true, eventId };
      }
    }
    throw error;
  }

  // §21: the Event is durably persisted at this point no matter what
  // happens next. enqueueEventProcessing throws (ApiError,
  // QUEUE_UNAVAILABLE/503) rather than resolving if the queue submission
  // itself fails — this propagates straight to the client as an error
  // response, so the API never claims asynchronous processing was queued
  // when it wasn't. The Event is NOT deleted or modified to hide this: it
  // remains in MongoDB with processingStatus:'pending', ready for a
  // client retry (which will hit the `existing` branch above and try
  // enqueueing again) or a future recovery/reconciliation worker (not
  // built this phase — see docs/QUEUE_ARCHITECTURE.md).
  await eventQueueService.enqueueEventProcessing({
    eventObjectId: created._id,
    websiteId: validated.websiteId,
    eventId,
  });

  // `duplicate` is omitted (not `false`) for a newly-accepted event —
  // matches the documented response shape exactly (Phase 4 §19), and
  // keeps the field meaningful as "present and true only when it happened".
  return { accepted: true, eventId };
}

export const eventService = { collectEvent };
