import { AnalyticsSessionBucket } from '../../models/AnalyticsSessionBucket.js';

export const sessionAnalyticsRepository = {
  async claim(websiteId, granularity, bucket, sessionId) {
    try {
      await AnalyticsSessionBucket.create({ websiteId, granularity, bucket, sessionId });
      return true;
    } catch (error) {
      if (error.code === 11000) {
        return false;
      }
      throw error;
    }
  },

  async countDistinctInRange(websiteId, granularity, from, to) {
    const [result] = await AnalyticsSessionBucket.aggregate([
      { $match: { websiteId, granularity, bucket: { $gte: from, $lt: to } } },
      { $group: { _id: '$sessionId' } },
      { $count: 'count' },
    ]);
    return result?.count ?? 0;
  },
};
