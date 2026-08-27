import { Cart } from '../models/Cart.js';

export const cartRepository = {
  async findByWebsiteAndCartId(websiteId, cartId) {
    return Cart.findOne({ websiteId, cartId });
  },

  async create(doc) {
    return Cart.create(doc);
  },

  async adjustTotals(id, { itemCountDelta, subtotalDelta, lastUpdatedAt }) {
    return Cart.findByIdAndUpdate(
      id,
      { $inc: { itemCount: itemCountDelta, subtotal: subtotalDelta }, $set: { lastUpdatedAt } },
      { new: true }
    );
  },
};
