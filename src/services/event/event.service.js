import crypto from 'node:crypto';
import { websiteRepository } from '../../repositories/website.repository.js';
import { eventRepository } from '../../repositories/event.repository.js';
import { eventQueueService } from '../../queues/event.queue.js';
import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';

const DEFAULT_EVENT_VERSION = '1';


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
    timestamp: validated.timestamp ?? context.receivedAt,
    receivedAt: context.receivedAt,
    url: validated.url,
    path: validated.path,
    title: validated.title,
    referrer: validated.referrer,
    anonymousId: validated.anonymousId,
    sessionId: validated.sessionId,
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

  await eventQueueService.enqueueEventProcessing({
    eventObjectId: created._id,
    websiteId: validated.websiteId,
    eventId,
  });

  return { accepted: true, eventId };
}

export const eventService = { collectEvent };
