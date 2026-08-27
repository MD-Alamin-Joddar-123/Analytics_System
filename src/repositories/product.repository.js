import { Product } from '../models/Product.js';

export const productRepository = {
  async findByWebsiteAndExternalId(websiteId, externalProductId) {
    return Product.findOne({ websiteId, externalProductId });
  },

  async create(doc) {
    return Product.create(doc);
  },

  async recordSighting(id, { lastSeenAt, name, price, currency }) {
    const set = { lastSeenAt };
    if (name !== undefined) set.name = name;
    if (price !== undefined) set.price = price;
    if (currency !== undefined) set.currency = currency;
    return Product.findByIdAndUpdate(id, { $set: set }, { new: true });
  },
};
