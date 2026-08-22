import { ProductAnalyticsBucket } from '../../models/ProductAnalyticsBucket.js';

const SUMMABLE_PRODUCT_FIELDS = ['productViews', 'addToCarts', 'removeFromCarts', 'unitsSold', 'orders', 'revenueMinor'];

function zeroedProductTotals() {
  return Object.fromEntries(SUMMABLE_PRODUCT_FIELDS.map((field) => [field, 0]));
}

export const productAnalyticsRepository = {
  // Same atomic upsert+$inc pattern and same concurrent-first-insert retry
  // as analytics.repository.js — see that file's comment for the full
  // rationale. `productName`, when provided, is refreshed via plain $set
  // (see ProductAnalyticsBucket's comment on why that's safe with respect
  // to §28's "don't overwrite historical analytics" rule).
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

  // --- Reporting (Phase 9) -----------------------------------------------

  // Summary totals for ONE product across [from, to) — the product detail
  // report's data source. Same $group/$sum-in-MongoDB, all-zero-default
  // shape as analytics.repository.js's sumBucketsInRange; also returns the
  // most recently observed productNameSnapshot within range (sorted
  // ascending by bucket first, so $last picks the latest one), so the
  // service layer only needs to fall back to the live Product document
  // when NO analytics activity exists in range at all.
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

  // The product list / "top products" report's data source (§3/§11/§12):
  // one aggregation call does the grouping, summing, sorting, AND
  // pagination together via $facet — never a separate count query (no
  // N+1), never paginating an array in JavaScript after loading everything.
  // `sortField` must already be a validated, allow-listed Mongo field name
  // (src/constants/reportingSort.js + reporting.validator.js) — this
  // repository never receives a raw client string here.
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
      { $sort: { [sortField]: sortOrder, _id: 1 } }, // _id tiebreaker for stable pagination ordering
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
