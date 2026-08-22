import { Cart } from '../models/Cart.js';

export const cartRepository = {
  async findByWebsiteAndCartId(websiteId, cartId) {
    return Cart.findOne({ websiteId, cartId });
  },

  async create(doc) {
    return Cart.create(doc);
  },

  // Incremental maintenance of itemCount/subtotal (see Cart model comment
  // for the accepted-drift tradeoff this implies). Deltas may be negative
  // (remove_from_cart). This is a plain $inc, not clamped at the database
  // level — the schema's `min: 0` does not reliably guard atomic $inc
  // updates, so the caller (cart.service.js) is responsible for never
  // passing a delta that could take a value below zero.
  async adjustTotals(id, { itemCountDelta, subtotalDelta, lastUpdatedAt }) {
    return Cart.findByIdAndUpdate(
      id,
      { $inc: { itemCount: itemCountDelta, subtotal: subtotalDelta }, $set: { lastUpdatedAt } },
      { new: true }
    );
  },
};
