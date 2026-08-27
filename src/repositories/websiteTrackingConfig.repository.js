import { WebsiteTrackingConfig } from '../models/WebsiteTrackingConfig.js';

export const websiteTrackingConfigRepository = {
  async findByWebsiteId(websiteId) {
    return WebsiteTrackingConfig.findOne({ websiteId });
  },

  async upsertByWebsiteId(websiteId, updates) {
    return WebsiteTrackingConfig.findOneAndReplace({ websiteId }, { websiteId, ...updates }, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });
  },
};
