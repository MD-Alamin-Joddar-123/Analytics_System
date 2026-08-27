import { AnalyticsEventProcessed } from '../../models/AnalyticsEventProcessed.js';

export const analyticsEventProcessedRepository = {
  async claim(websiteId, eventId) {
    try {
      return await AnalyticsEventProcessed.create({ websiteId, eventId, processedAt: new Date() });
    } catch (error) {
      if (error.code === 11000) {
        return null;
      }
      throw error;
    }
  },

  async release(websiteId, eventId) {
    try {
      await AnalyticsEventProcessed.deleteOne({ websiteId, eventId });
    } catch {
    }
  },
};
