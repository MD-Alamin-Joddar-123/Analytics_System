import { WebsiteTrackingConfig } from '../models/WebsiteTrackingConfig.js';

export const websiteTrackingConfigRepository = {
  async findByWebsiteId(websiteId) {
    return WebsiteTrackingConfig.findOne({ websiteId });
  },

  // One document per website (§1) — the dashboard's save action is always
  // "replace the current config," never "add another," so this is an
  // upsert rather than separate create/update methods.
  //
  // findOneAndReplace, deliberately NOT findOneAndUpdate + $set: a $set
  // only touches the keys present in `updates` and leaves anything else on
  // the existing document untouched — so a field the dashboard form
  // cleared back to empty (present as '', which trim/validation handles
  // normally) is fine, but a field genuinely OMITTED from the payload
  // would silently keep stale data from a previous save. A full replace
  // means the saved document always matches exactly what was submitted.
  async upsertByWebsiteId(websiteId, updates) {
    return WebsiteTrackingConfig.findOneAndReplace({ websiteId }, { websiteId, ...updates }, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });
  },
};
