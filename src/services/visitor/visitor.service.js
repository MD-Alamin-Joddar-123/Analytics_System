import { visitorRepository } from '../../repositories/visitor.repository.js';

async function resolveVisitor(websiteId, anonymousId, context) {
  if (!anonymousId) {
    return { visitor: null, isNew: false };
  }

  const existing = await visitorRepository.findByWebsiteAndAnonymousId(websiteId, anonymousId);
  if (existing) {
    return { visitor: existing, isNew: false };
  }

  try {
    const created = await visitorRepository.create({
      websiteId,
      anonymousId,
      firstSeenAt: context.receivedAt,
      lastSeenAt: context.receivedAt,
      firstUrl: context.url,
      lastUrl: context.url,
      firstReferrer: context.referrer,
      lastReferrer: context.referrer,
      userAgent: context.userAgent,
      language: context.language,
      timezone: context.timezone,
      screenWidth: context.screenWidth,
      screenHeight: context.screenHeight,
      sessionCount: 0,
      eventCount: 0,
    });
    return { visitor: created, isNew: true };
  } catch (error) {
    if (error.code === 11000) {
      const winner = await visitorRepository.findByWebsiteAndAnonymousId(websiteId, anonymousId);
      if (winner) {
        return { visitor: winner, isNew: false };
      }
    }
    throw error;
  }
}

async function recordVisitorActivity(visitor, { isNewVisitor, session, isNewSession, receivedAt, url, referrer }) {
  return visitorRepository.recordActivity(visitor._id, {
    lastSeenAt: receivedAt,
    lastUrl: url,
    lastReferrer: referrer,
    lastSessionId: session ? session.sessionId : undefined,
    firstSessionId: isNewVisitor && session ? session.sessionId : undefined,
    incrementSessionCount: Boolean(isNewSession),
  });
}

export const visitorService = { resolveVisitor, recordVisitorActivity };
