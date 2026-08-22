import { Product } from '../models/Product.js';

// Exported as a plain object so individual methods can be mocked at the
// boundary in tests without a live database connection — same pattern as
// the other repositories.
export const productRepository = {
  async findByWebsiteAndExternalId(websiteId, externalProductId) {
    return Product.findOne({ websiteId, externalProductId });
  },

  async create(doc) {
    return Product.create(doc);
  },

  // Refreshes only the fields actually provided by this sighting — never
  // blanks out a previously-known name/price/currency with an event that
  // simply didn't mention them. firstSeenAt is deliberately never touched
  // here.
  async recordSighting(id, { lastSeenAt, name, price, currency }) {
    const set = { lastSeenAt };
    if (name !== undefined) set.name = name;
    if (price !== undefined) set.price = price;
    if (currency !== undefined) set.currency = currency;
    return Product.findByIdAndUpdate(id, { $set: set }, { new: true });
  },
};
