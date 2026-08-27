import { Event } from '../models/Event.js';

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

export const eventRepository = {
  async create(eventDoc) {
    return Event.create(eventDoc);
  },

  async existsByWebsiteAndEventId(websiteId, eventId) {
    const match = await Event.exists({ websiteId, eventId });
    return Boolean(match);
  },

  async findByWebsiteAndEventId(websiteId, eventId) {
    return Event.findOne({ websiteId, eventId });
  },

  async findById(id) {
    return Event.findById(id);
  },

  async findByWebsiteId(websiteId, { limit = 50 } = {}) {
    return Event.find({ websiteId }).sort({ timestamp: -1 }).limit(limit);
  },


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

  async markProcessingFailed(id, errorMessage) {
    return Event.findByIdAndUpdate(
      id,
      { $set: { processingStatus: 'failed', lastProcessingError: String(errorMessage ?? '').slice(0, 1000) } },
      { new: true }
    );
  },


  async findManyByWebsiteFiltered(websiteId, filters, { sortField, sortOrder, skip, limit }) {
    return Event.find(buildActivityFilter(websiteId, filters))
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limit);
  },

  async countByWebsiteFiltered(websiteId, filters) {
    return Event.countDocuments(buildActivityFilter(websiteId, filters));
  },

  async findPurchaseEventByOrderId(websiteId, externalOrderId) {
    return Event.findOne({ websiteId, eventName: 'purchase', 'data.orderId': externalOrderId });
  },

  async findManyByWebsiteAndSessionObjectId(websiteId, sessionObjectId, { limit } = {}) {
    return Event.find({ websiteId, sessionObjectId }).sort({ timestamp: 1 }).limit(limit);
  },
};
