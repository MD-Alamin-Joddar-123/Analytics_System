import { AnalyticsVisitorBucket } from '../../models/AnalyticsVisitorBucket.js';

export const visitorAnalyticsRepository = {
  // Attempts to claim "this visitor counts toward uniqueVisitors in this
  // bucket" (Phase 8 §11/§12). Returns true when this call was the FIRST
  // to see this visitor in this bucket (the caller should then $inc
  // uniqueVisitors), false when some other event already claimed it
  // (11000 — a safe, expected outcome under concurrency, not an error).
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

  // Phase 9 §1: the TRUE distinct-visitor count across an arbitrary
  // [from, to) range — grouping the underlying claim documents by
  // anonymousId, not summing AnalyticsBucket.uniqueVisitors across buckets
  // (which would over-count a visitor active in more than one bucket; see
  // analytics.repository.js's SUMMABLE_COUNTER_FIELDS comment for why).
  // Still queries only an aggregation collection, never Event.
  async countDistinctInRange(websiteId, granularity, from, to) {
    const [result] = await AnalyticsVisitorBucket.aggregate([
      { $match: { websiteId, granularity, bucket: { $gte: from, $lt: to } } },
      { $group: { _id: '$anonymousId' } },
      { $count: 'count' },
    ]);
    return result?.count ?? 0;
  },
};
