import { Visitor } from '../models/Visitor.js';

export const visitorRepository = {
  async findByWebsiteAndAnonymousId(websiteId, anonymousId) {
    return Visitor.findOne({ websiteId, anonymousId });
  },

  async create(doc) {
    return Visitor.create(doc);
  },

  async findById(id) {
    return Visitor.findById(id);
  },

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
