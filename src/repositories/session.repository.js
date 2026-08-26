import { Session } from '../models/Session.js';

// Exported as a plain object so individual methods can be mocked at the
// boundary in tests without a live database connection — same pattern as
// the other repositories.
export const sessionRepository = {
  async findByWebsiteAndSessionId(websiteId, sessionId) {
    return Session.findOne({ websiteId, sessionId });
  },

  async create(doc) {
    return Session.create(doc);
  },

  // Best-effort bookkeeping when a session is discovered to have expired
  // (Phase 5 §18) — not on the critical path for accepting the triggering
  // event, just marks when the old session's activity effectively stopped.
  async markEnded(id, endedAt) {
    return Session.findByIdAndUpdate(id, { $set: { endedAt } }, { new: true });
  },

  // One atomic update for every "on accepted event" mutation: eventCount
  // always +1, pageViewCount +1 only for page_view events, lastActivityAt
  // always refreshed, exitPage set only for page_view events. Only ever
  // called once per genuinely-newly-persisted event (see
  // event.service.js), which is what keeps counters from double-counting
  // on a duplicate/retried request.
  async recordActivity(id, { lastActivityAt, incrementPageView, exitPage }) {
    const set = { lastActivityAt };
    if (exitPage !== undefined) set.exitPage = exitPage;

    const inc = { eventCount: 1 };
    if (incrementPageView) inc.pageViewCount = 1;

    return Session.findByIdAndUpdate(id, { $set: set, $inc: inc }, { new: true });
  },

  // --- Phase 12.5: Tracking Observability (read-only listing/detail) ---

  // Every session that STARTED inside the range, reduced to just its
  // entry referrer. Projected down to the one field the traffic-source
  // report needs rather than loading whole documents — a busy site can
  // have a lot of sessions in a week, and none of the rest is used.
  //
  // Grouped in Mongo rather than in JavaScript so the response size is
  // bounded by the number of DISTINCT referrers, not by session count.
  async aggregateEntryReferrers(websiteId, from, to) {
    return Session.aggregate([
      { $match: { websiteId, startedAt: { $gte: from, $lt: to } } },
      { $group: { _id: '$entryReferrer', sessions: { $sum: 1 } } },
      { $sort: { sessions: -1 } },
    ]);
  },

  async findManyByWebsite(websiteId, { sortField, sortOrder, skip, limit }) {
    return Session.find({ websiteId })
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limit);
  },

  async countByWebsite(websiteId) {
    return Session.countDocuments({ websiteId });
  },

  // A visitor's session history (Visitor detail page) — bounded, most
  // recent first, not paginated (§ VISITOR_SESSION_HISTORY_MAX).
  async findManyByWebsiteAndVisitor(websiteId, visitorObjectId, { limit } = {}) {
    return Session.find({ websiteId, visitorId: visitorObjectId })
      .sort({ startedAt: -1 })
      .limit(limit);
  },
};
