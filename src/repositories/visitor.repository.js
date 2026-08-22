import { Visitor } from '../models/Visitor.js';

// Exported as a plain object so individual methods can be mocked at the
// boundary in tests without a live database connection — same pattern as
// the other repositories.
export const visitorRepository = {
  async findByWebsiteAndAnonymousId(websiteId, anonymousId) {
    return Visitor.findOne({ websiteId, anonymousId });
  },

  async create(doc) {
    return Visitor.create(doc);
  },

  // Reserved for future internal/dashboard use — not called by the
  // collector pipeline itself.
  async findById(id) {
    return Visitor.findById(id);
  },

  // One atomic update covering every "on accepted event" mutation this
  // phase needs, in a single round trip: lastSeenAt/lastUrl/lastReferrer
  // always; lastSessionId always (mirrors the visitor's current session);
  // firstSessionId only once, when the caller tells us this is the
  // visitor's first-ever session; sessionCount incremented only when the
  // caller tells us a NEW session was resolved for this event (not on
  // every event — see session.service.js's isNew flag). eventCount always
  // increments by exactly 1 — this method is only ever called once per
  // genuinely-newly-persisted event, never for a duplicate (see
  // event.service.js), which is what keeps it from double-counting.
  async recordActivity(
    id,
    { lastSeenAt, lastUrl, lastReferrer, lastSessionId, firstSessionId, incrementSessionCount }
  ) {
    const set = { lastSeenAt };
    if (lastUrl !== undefined) set.lastUrl = lastUrl;
    if (lastReferrer !== undefined) set.lastReferrer = lastReferrer;
    if (lastSessionId !== undefined) set.lastSessionId = lastSessionId;
    if (firstSessionId !== undefined) set.firstSessionId = firstSessionId;

    const inc = { eventCount: 1 };
    if (incrementSessionCount) inc.sessionCount = 1;

    return Visitor.findByIdAndUpdate(id, { $set: set, $inc: inc }, { new: true });
  },

  // --- Phase 12.5: Tracking Observability (read-only listing/detail) ---

  async findManyByWebsite(websiteId, { sortField, sortOrder, skip, limit }) {
    return Visitor.find({ websiteId })
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limit);
  },

  async countByWebsite(websiteId) {
    return Visitor.countDocuments({ websiteId });
  },
};
