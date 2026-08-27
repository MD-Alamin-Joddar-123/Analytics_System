import { Session } from '../models/Session.js';

export const sessionRepository = {
  async findByWebsiteAndSessionId(websiteId, sessionId) {
    return Session.findOne({ websiteId, sessionId });
  },

  async create(doc) {
    return Session.create(doc);
  },

  async markEnded(id, endedAt) {
    return Session.findByIdAndUpdate(id, { $set: { endedAt } }, { new: true });
  },

  async recordActivity(id, { lastActivityAt, incrementPageView, exitPage }) {
    const set = { lastActivityAt };
    if (exitPage !== undefined) set.exitPage = exitPage;

    const inc = { eventCount: 1 };
    if (incrementPageView) inc.pageViewCount = 1;

    return Session.findByIdAndUpdate(id, { $set: set, $inc: inc }, { new: true });
  },


  async aggregateEntryReferrersByBucket(websiteId, from, to, granularity) {
    return Session.aggregate([
      { $match: { websiteId, startedAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { date: '$startedAt', unit: granularity } },
            referrer: '$entryReferrer',
          },
          sessions: { $sum: 1 },
        },
      },
      { $sort: { '_id.bucket': 1 } },
    ]);
  },

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

  async findManyByWebsiteAndVisitor(websiteId, visitorObjectId, { limit } = {}) {
    return Session.find({ websiteId, visitorId: visitorObjectId })
      .sort({ startedAt: -1 })
      .limit(limit);
  },
};
