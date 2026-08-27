import { ProductAnalyticsBucket } from '../../models/ProductAnalyticsBucket.js';

const SUMMABLE_PRODUCT_FIELDS = ['productViews', 'addToCarts', 'removeFromCarts', 'unitsSold', 'orders', 'revenueMinor'];

function zeroedProductTotals() {
  return Object.fromEntries(SUMMABLE_PRODUCT_FIELDS.map((field) => [field, 0]));
}

export const productAnalyticsRepository = {
  async incrementProductBucket(websiteId, productId, granularity, bucket, productName, inc) {
    const filter = { websiteId, productId, granularity, bucket };
    const update = { $inc: inc };
    if (productName !== undefined) {
      update.$set = { productNameSnapshot: productName };
    }
    try {
      return await ProductAnalyticsBucket.findOneAndUpdate(filter, update, { new: true, upsert: true });
    } catch (error) {
      if (error.code === 11000) {
        return ProductAnalyticsBucket.findOneAndUpdate(filter, update, { new: true, upsert: true });
      }
      throw error;
    }
  },

  async findProductBucket(websiteId, productId, granularity, bucket) {
    return ProductAnalyticsBucket.findOne({ websiteId, productId, granularity, bucket });
  },


  async sumProductBucketsInRange(websiteId, productId, granularity, from, to) {
    const [result] = await ProductAnalyticsBucket.aggregate([
      { $match: { websiteId, productId, granularity, bucket: { $gte: from, $lt: to } } },
      { $sort: { bucket: 1 } },
      {
        $group: {
          _id: null,
          productName: { $last: '$productNameSnapshot' },
          ...Object.fromEntries(SUMMABLE_PRODUCT_FIELDS.map((field) => [field, { $sum: `$${field}` }])),
        },
      },
    ]);
    if (!result) return { productName: undefined, ...zeroedProductTotals() };
    const { _id, ...totals } = result;
    return { ...zeroedProductTotals(), ...totals };
  },

  async aggregateTopProducts(websiteId, granularity, from, to, { sortField, sortOrder, skip, limit }) {
    const [result] = await ProductAnalyticsBucket.aggregate([
      { $match: { websiteId, granularity, bucket: { $gte: from, $lt: to } } },
      { $sort: { bucket: 1 } },
      {
        $group: {
          _id: '$productId',
          productName: { $last: '$productNameSnapshot' },
          ...Object.fromEntries(SUMMABLE_PRODUCT_FIELDS.map((field) => [field, { $sum: `$${field}` }])),
        },
      },
      { $sort: { [sortField]: sortOrder, _id: 1 } },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ]);
    return {
      items: result?.items ?? [],
      total: result?.totalCount?.[0]?.count ?? 0,
    };
  },
};
