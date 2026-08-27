import { CartItem } from '../models/CartItem.js';

export const cartItemRepository = {
  async findByCartAndProduct(websiteId, cartId, externalProductId) {
    return CartItem.findOne({ websiteId, cartId, externalProductId });
  },

  async create(doc) {
    return CartItem.create(doc);
  },

  async incrementQuantity(id, delta) {
    return CartItem.findByIdAndUpdate(id, { $inc: { quantity: delta } }, { new: true });
  },

  async deleteById(id) {
    return CartItem.findByIdAndDelete(id);
  },
};
