import { OrderItem } from '../models/OrderItem.js';

export const orderItemRepository = {
  // Order line items are only ever created once, when the Order itself is
  // first created (see order.service.js) — there is no update path here
  // by design, since OrderItem is a purchase-time snapshot (§6).
  async createMany(docs) {
    if (!docs || docs.length === 0) return [];
    return OrderItem.insertMany(docs);
  },

  // Reserved for future internal/dashboard use — not called by the event
  // pipeline itself.
  async findByOrder(websiteId, orderId) {
    return OrderItem.find({ websiteId, orderId });
  },

  // Phase 12.5: bulk item-count for the Orders list page (one aggregation
  // per page of orders, never N+1 — see observability.service.js). Keyed
  // by the OrderItem's own `orderId` ObjectId (a resolved reference to the
  // Order document), never an external id.
  async countByOrders(websiteId, orderObjectIds) {
    if (!orderObjectIds || orderObjectIds.length === 0) return {};
    const rows = await OrderItem.aggregate([
      { $match: { websiteId, orderId: { $in: orderObjectIds } } },
      { $group: { _id: '$orderId', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((row) => [String(row._id), row.count]));
  },
};
