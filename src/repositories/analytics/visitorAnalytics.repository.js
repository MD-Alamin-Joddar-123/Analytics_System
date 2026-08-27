import { AnalyticsVisitorBucket } from '../../models/AnalyticsVisitorBucket.js';

export const visitorAnalyticsRepository = {
  async claim(websiteId, granularity, bucket, anonymousId) {
    try {
      await AnalyticsVisitorBucket.create({ websiteId, granularity, bucket, anonymousId });
      return true;
    } catch (error) {
      if (error.code === 11000) {
        return false;
      }
      throw error;
    }
  },

  async countDistinctInRange(websiteId, granularity, from, to) {
    const [result] = await AnalyticsVisitorBucket.aggregate([
      { $match: { websiteId, granularity, bucket: { $gte: from, $lt: to } } },
      { $group: { _id: '$anonymousId' } },
      { $count: 'count' },
    ]);
    return result?.count ?? 0;
  },
};
