import { Order } from '../models/Order.js';

export const orderRepository = {
  async findByWebsiteAndExternalOrderId(websiteId, externalOrderId) {
    return Order.findOne({ websiteId, externalOrderId });
  },

  async create(doc) {
    return Order.create(doc);
  },

  async update(id, updates) {
    return Order.findByIdAndUpdate(id, { $set: updates }, { new: true });
  },

  // --- Phase 12.5: Tracking Observability (read-only listing/detail) ---

  async findManyByWebsite(websiteId, { sortField, sortOrder, skip, limit }) {
    return Order.find({ websiteId })
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limit);
  },

  async countByWebsite(websiteId) {
    return Order.countDocuments({ websiteId });
  },
};
