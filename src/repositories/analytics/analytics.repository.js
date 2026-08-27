import { AnalyticsBucket } from '../../models/AnalyticsBucket.js';

const SUMMABLE_COUNTER_FIELDS = [
  'pageViews',
  'productViews',
  'addToCarts',
  'removeFromCarts',
  'cartsCreated',
  'cartItems',
  'cartQuantity',
  'cartValueMinor',
  'checkoutStarted',
  'checkoutCompleted',
  'orders',
  'unitsSold',
  'grossRevenueMinor',
  'refundedAmountMinor',
  'netRevenueMinor',
];

function zeroedTotals() {
  return Object.fromEntries(SUMMABLE_COUNTER_FIELDS.map((field) => [field, 0]));
}

export const analyticsRepository = {
  async incrementBucket(websiteId, granularity, bucket, currency, inc) {
    const filter = { websiteId, granularity, bucket };
    const update = { $inc: inc };
    if (currency) {
      update.$set = { currency };
    }
    try {
      return await AnalyticsBucket.findOneAndUpdate(filter, update, { new: true, upsert: true });
    } catch (error) {
      if (error.code === 11000) {
        return AnalyticsBucket.findOneAndUpdate(filter, update, { new: true, upsert: true });
      }
      throw error;
    }
  },

  async findBucket(websiteId, granularity, bucket) {
    return AnalyticsBucket.findOne({ websiteId, granularity, bucket });
  },


  async sumBucketsInRange(websiteId, granularity, from, to) {
    const [result] = await AnalyticsBucket.aggregate([
      { $match: { websiteId, granularity, bucket: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: null,
          ...Object.fromEntries(SUMMABLE_COUNTER_FIELDS.map((field) => [field, { $sum: `$${field}` }])),
        },
      },
    ]);
    if (!result) return zeroedTotals();
    const { _id, ...totals } = result;
    return { ...zeroedTotals(), ...totals };
  },

  async findBucketsInRange(websiteId, granularity, from, to) {
    return AnalyticsBucket.find({ websiteId, granularity, bucket: { $gte: from, $lt: to } })
      .sort({ bucket: 1 })
      .lean();
  },
};
