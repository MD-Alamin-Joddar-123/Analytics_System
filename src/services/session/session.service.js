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
      // Lost a race with a concurrent first event for the same sessionId
      // (Phase 5 §29) — use whichever document actually landed.
      const winner = await sessionRepository.findByWebsiteAndSessionId(websiteId, sessionId);
      if (winner) {
        return { session: winner, isNew: false };
      }
    }
    throw error;
  }
}

// Session identity is (websiteId, sessionId), and that pair is permanently
// unique (Phase 5 §7/§26) — a given sessionId string can never be reused
// for a second document, even after the original expires. So when an
// incoming sessionId resolves to an expired session, continuation cannot
// reuse that string; it gets a fresh server-generated one instead. A
// well-behaved future SDK is expected to notice its local session expired
// and generate a new id itself before that happens (Phase 5 §21) — this
// path exists so the backend behaves correctly even without that SDK.
async function resolveSession(websiteId, sessionId, visitor, context, timeoutMs) {
  // No visitor to own the session (anonymousId was missing) — nothing to
  // resolve. See visitor.service.js for the privacy rationale.
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

    // First time this sessionId string has been seen — use it as-is.
    return createNewSession(websiteId, sessionId, visitor, context);
  }

  // No client-supplied sessionId: nothing correlates this event with any
  // other one from the same visitor, so each such event gets its own
  // single-event session (Phase 5 §21). The SDK is expected to generate
  // and persist a sessionId client-side for meaningful session grouping;
  // this is a safe, honest fallback for when it doesn't, not an attempt to
  // guess at continuity the backend has no way to know about.
  return createNewSession(websiteId, crypto.randomUUID(), visitor, context);
}

// Called exactly once per genuinely-newly-persisted event (never for a
// duplicate — see event.service.js), which is the invariant that keeps
// eventCount/pageViewCount from double-counting on a retried request.
async function recordSessionActivity(session, { eventName, receivedAt, url }) {
  const isPageView = eventName === 'page_view';
  return sessionRepository.recordActivity(session._id, {
    lastActivityAt: receivedAt,
    incrementPageView: isPageView,
    // exitPage only ever moves on a page_view — a trailing add_to_cart or
    // purchase on the same page doesn't change "the last page viewed".
    exitPage: isPageView ? url : undefined,
  });
}

export const sessionService = { resolveSession, recordSessionActivity };
