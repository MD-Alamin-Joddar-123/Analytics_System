import { CartItem } from '../models/CartItem.js';

export const cartItemRepository = {
  async findByCartAndProduct(websiteId, cartId, externalProductId) {
    return CartItem.findOne({ websiteId, cartId, externalProductId });
  },

  async create(doc) {
    return CartItem.create(doc);
  },

  // delta may be negative (remove_from_cart) — the caller is responsible
  // for never passing a delta that would take quantity below 1 (a
  // decrement that would reach zero deletes the document instead; see
  // cart.service.js).
  async incrementQuantity(id, delta) {
    return CartItem.findByIdAndUpdate(id, { $inc: { quantity: delta } }, { new: true });
  },

  async deleteById(id) {
    return CartItem.findByIdAndDelete(id);
  },
};
