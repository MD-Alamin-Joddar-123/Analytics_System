import { Checkout } from '../models/Checkout.js';

export const checkoutRepository = {
  async findByWebsiteAndCheckoutId(websiteId, checkoutId) {
    return Checkout.findOne({ websiteId, checkoutId });
  },

  async create(doc) {
    return Checkout.create(doc);
  },

  async update(id, updates) {
    return Checkout.findByIdAndUpdate(id, { $set: updates }, { new: true });
  },
};
