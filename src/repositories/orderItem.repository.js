import { OrderItem } from '../models/OrderItem.js';

export const orderItemRepository = {
  async createMany(docs) {
    if (!docs || docs.length === 0) return [];
    return OrderItem.insertMany(docs);
  },

  async findByOrder(websiteId, orderId) {
    return OrderItem.find({ websiteId, orderId });
  },

  async countByOrders(websiteId, orderObjectIds) {
    if (!orderObjectIds || orderObjectIds.length === 0) return {};
    const rows = await OrderItem.aggregate([
      { $match: { websiteId, orderId: { $in: orderObjectIds } } },
      { $group: { _id: '$orderId', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((row) => [String(row._id), row.count]));
  },
};
