import { visitorRepository } from '../../repositories/visitor.repository.js';

// Privacy (Phase 5 §20): if the client sent no anonymousId, we do NOT
// fabricate one from IP/user-agent/anything else. The event is still
// accepted (event.service.js persists it regardless) but simply has no
// visitor to attach to — an "unidentifiable/anonymous" event, which is a
// documented, intentional outcome, not an error state.
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
      // Lost a race with a concurrent first event for the same brand-new
      // anonymousId (Phase 5 §29) — the unique index prevented a second
      // document; use whichever one actually landed.
      const winner = await visitorRepository.findByWebsiteAndAnonymousId(websiteId, anonymousId);
      if (winner) {
        return { visitor: winner, isNew: false };
      }
    }
    throw error;
  }
}

// Called exactly once per genuinely-newly-persisted event (never for a
// duplicate — see event.service.js), which is the invariant that keeps
// eventCount/sessionCount from double-counting on a retried request.
async function recordVisitorActivity(visitor, { isNewVisitor, session, isNewSession, receivedAt, url, referrer }) {
  return visitorRepository.recordActivity(visitor._id, {
    lastSeenAt: receivedAt,
    lastUrl: url,
    lastReferrer: referrer,
    lastSessionId: session ? session.sessionId : undefined,
    // Only ever set once: the very first session this visitor is
    // associated with. isNewVisitor is only true for the request that
    // actually created the visitor document, so this can't be
    // accidentally overwritten by a later session.
    firstSessionId: isNewVisitor && session ? session.sessionId : undefined,
    incrementSessionCount: Boolean(isNewSession),
  });
}

export const visitorService = { resolveVisitor, recordVisitorActivity };
