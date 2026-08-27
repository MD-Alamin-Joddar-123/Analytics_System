import crypto from 'node:crypto';
import { sessionRepository } from '../../repositories/session.repository.js';

async function createNewSession(websiteId, sessionId, visitor, context) {
  try {
    const created = await sessionRepository.create({
      websiteId,
      sessionId,
      anonymousId: visitor.anonymousId,
      visitorId: visitor._id,
      startedAt: context.receivedAt,
      lastActivityAt: context.receivedAt,
      landingPage: context.url,
      entryReferrer: context.referrer,
      userAgent: context.userAgent,
      language: context.language,
      timezone: context.timezone,
      screenWidth: context.screenWidth,
      screenHeight: context.screenHeight,
      eventCount: 0,
      pageViewCount: 0,
    });
    return { session: created, isNew: true };
  } catch (error) {
    if (error.code === 11000) {
      const winner = await sessionRepository.findByWebsiteAndSessionId(websiteId, sessionId);
      if (winner) {
        return { session: winner, isNew: false };
      }
    }
    throw error;
  }
}

async function resolveSession(websiteId, sessionId, visitor, context, timeoutMs) {
  if (!visitor) {
    return { session: null, isNew: false };
  }

  if (sessionId) {
    const existing = await sessionRepository.findByWebsiteAndSessionId(websiteId, sessionId);

    if (existing) {
      const isActive = context.receivedAt.getTime() - existing.lastActivityAt.getTime() < timeoutMs;
      if (isActive) {
        return { session: existing, isNew: false };
      }

      await sessionRepository.markEnded(existing._id, existing.lastActivityAt);
      return createNewSession(websiteId, crypto.randomUUID(), visitor, context);
    }

    return createNewSession(websiteId, sessionId, visitor, context);
  }

  return createNewSession(websiteId, crypto.randomUUID(), visitor, context);
}

async function recordSessionActivity(session, { eventName, receivedAt, url }) {
  const isPageView = eventName === 'page_view';
  return sessionRepository.recordActivity(session._id, {
    lastActivityAt: receivedAt,
    incrementPageView: isPageView,
    exitPage: isPageView ? url : undefined,
  });
}

export const sessionService = { resolveSession, recordSessionActivity };
