import { Event } from '../models/Event.js';

// Phase 12.5: builds the shared Mongo filter for the Events observability
// list — every optional filter (eventName/date range/visitor/session) is
// applied only when actually provided by the caller, on top of the
// mandatory websiteId scope every query in this file already carries.
function buildActivityFilter(websiteId, { eventName, from, to, anonymousId, sessionId } = {}) {
  const query = { websiteId };
  if (eventName !== undefined) query.eventName = eventName;
  if (anonymousId !== undefined) query.anonymousId = anonymousId;
  if (sessionId !== undefined) query.sessionId = sessionId;
  if (from !== undefined || to !== undefined) {
    query.timestamp = {};
    if (from !== undefined) query.timestamp.$gte = from;
    if (to !== undefined) query.timestamp.$lte = to;
  }
  return query;
}

// Exported as a plain object so individual methods can be mocked at the
// boundary in tests without a live database connection — same pattern as
// user.repository.js and website.repository.js.
export const eventRepository = {
  async create(eventDoc) {
    return Event.create(eventDoc);
  },

  // The idempotency check (Phase 4 §8): websiteId + eventId is the
  // identity. A lightweight existence check avoids fetching (and later
  // discarding) a full document just to answer "have we seen this one?".
  // Retained for any caller that only needs a boolean (e.g. a future
  // lightweight check) — event.service.js itself now uses
  // findByWebsiteAndEventId (below), since Phase 7's duplicate handling
  // needs to inspect processingStatus, not just existence.
  async existsByWebsiteAndEventId(websiteId, eventId) {
    const match = await Event.exists({ websiteId, eventId });
    return Boolean(match);
  },

  // Phase 7 §15: ingestion needs the full document (specifically
  // `processingStatus`) to decide how to respond to a duplicate
  // submission, not just a yes/no existence check.
  async findByWebsiteAndEventId(websiteId, eventId) {
    return Event.findOne({ websiteId, eventId });
  },

  async findById(id) {
    return Event.findById(id);
  },

  // Reserved for future use (Phase 5+ dashboard/debugging queries) — not
  // called by the collector itself, and deliberately does no aggregation.
  async findByWebsiteId(websiteId, { limit = 50 } = {}) {
    return Event.find({ websiteId }).sort({ timestamp: -1 }).limit(limit);
  },

  // --- Processing state transitions (Phase 7) ---------------------------
  // Each is a single atomic update — see docs/QUEUE_ARCHITECTURE.md for
  // the full state machine these implement.

  async markProcessingStarted(id) {
    return Event.findByIdAndUpdate(
      id,
      {
        $set: { processingStatus: 'processing', lastProcessingAttemptAt: new Date() },
        $inc: { processingAttempts: 1 },
      },
      { new: true }
    );
  },

  async markProcessingCompleted(id, { visitorId, sessionObjectId } = {}) {
    const set = { processingStatus: 'completed', processedAt: new Date() };
    if (visitorId !== undefined) set.visitorId = visitorId;
    if (sessionObjectId !== undefined) set.sessionObjectId = sessionObjectId;
    return Event.findByIdAndUpdate(id, { $set: set }, { new: true });
  },

  // errorMessage is capped defensively (schema also enforces maxlength) —
  // this is a diagnostic string, never a raw payload/object dump.
  async markProcessingFailed(id, errorMessage) {
    return Event.findByIdAndUpdate(
      id,
      { $set: { processingStatus: 'failed', lastProcessingError: String(errorMessage ?? '').slice(0, 1000) } },
      { new: true }
    );
  },

  // --- Phase 12.5: Tracking Observability (read-only listing/detail) ---

  async findManyByWebsiteFiltered(websiteId, filters, { sortField, sortOrder, skip, limit }) {
    return Event.find(buildActivityFilter(websiteId, filters))
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limit);
  },

  async countByWebsiteFiltered(websiteId, filters) {
    return Event.countDocuments(buildActivityFilter(websiteId, filters));
  },

  // Best-effort link from a purchase Order back to the raw purchase Event
  // that produced it (Order Detail's "linked checkout" — Order itself does
  // not store a checkoutId, only the Event that recorded the purchase
  // does, in `data.checkoutId`). Read-only, not on the collector path.
  async findPurchaseEventByOrderId(websiteId, externalOrderId) {
    return Event.findOne({ websiteId, eventName: 'purchase', 'data.orderId': externalOrderId });
  },

  // A session's chronological event timeline (Session Detail). Joined by
  // the RESOLVED `sessionObjectId` reference, not the raw client-sent
  // `sessionId` string — the two can legitimately diverge when a session
  // expired mid-stream and was continued under a new Session document (see
  // Session model's own doc comment / session.service.js), so the resolved
  // reference is the semantically correct "events that actually landed in
  // this session" join.
  async findManyByWebsiteAndSessionObjectId(websiteId, sessionObjectId, { limit } = {}) {
    return Event.find({ websiteId, sessionObjectId }).sort({ timestamp: 1 }).limit(limit);
  },
};
