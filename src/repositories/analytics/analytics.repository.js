import { AnalyticsBucket } from '../../models/AnalyticsBucket.js';

// Every $sum-able counter on AnalyticsBucket EXCEPT uniqueVisitors/
// uniqueSessions (Phase 9 §1/§5). Summing per-bucket unique counts across
// multiple buckets would OVER-count any visitor/session active in more
// than one bucket within the requested range — a visitor seen in both the
// 09:00 and 10:00 hour buckets contributes 1 to each bucket's
// uniqueVisitors, but is one distinct visitor across the combined range,
// not two. True range-wide distinct counts come from
// visitorAnalyticsRepository/sessionAnalyticsRepository's
// countDistinctInRange() instead (grouping the underlying claim documents
// by identity), never from summing this field — see
// docs/REPORTING_API_ARCHITECTURE.md for the full explanation. Per-bucket
// values (findBucketsInRange, used by the time-series report) don't have
// this problem: each point already IS one bucket's own true count.
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

// Exported as a plain object so individual methods can be mocked at the
// boundary in tests without a live database connection — same pattern used
// by every other repository in this codebase.
export const analyticsRepository = {
  // Atomic upsert+$inc (Phase 8 §21/§22) — never find-modify-save. `inc`
  // must be a non-empty plain object of counter deltas; callers
  // (analyticsAggregation.service.js) only invoke this when there's
  // actually something to increment.
  //
  // MongoDB upsert has a known race under high concurrency (§23): two
  // concurrent findOneAndUpdate({upsert:true}) calls racing to create the
  // SAME bucket document for the first time can both attempt the insert,
  // and one loses with a duplicate-key error even though upsert:true was
  // set — because the unique-index check and the insert aren't a single
  // step relative to another concurrent upsert. The fix is the same
  // pattern used everywhere else in this codebase for "concurrent first
  // creation" (Product/Cart/Order/etc): catch 11000 and retry once, now as
  // a plain update against the document the other request just created.
  async incrementBucket(websiteId, granularity, bucket, currency, inc) {
    const filter = { websiteId, granularity, bucket };
    const update = { $inc: inc };
    // Plain $set (not $setOnInsert): refreshing the current bucket's
    // currency snapshot on every write that carries one is fine — it can
    // never touch a PAST bucket document, since the filter is always
    // scoped to this one specific bucket (see ProductAnalyticsBucket's
    // comment for the same reasoning applied to productNameSnapshot).
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

  // --- Reporting (Phase 9) -----------------------------------------------
  // Both methods below query ONLY this aggregation collection — never
  // Event — and both are scoped by websiteId as the leading filter (§4/§9),
  // matching the unique index's own field order so MongoDB can use it.

  // A single summary total across an arbitrary [from, to) range, computed
  // by MongoDB itself via $group/$sum (§15/§17) — never by loading bucket
  // documents into Node and adding them up in JavaScript. Returns an
  // all-zero object (never null/undefined) when no buckets exist in range,
  // so callers never need a separate "empty range" branch.
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

  // The ordered list of individual bucket documents in range — each one
  // IS a report point already; the time-series report (§2) just formats
  // them, it does not sum or recompute anything.
  async findBucketsInRange(websiteId, granularity, from, to) {
    return AnalyticsBucket.find({ websiteId, granularity, bucket: { $gte: from, $lt: to } })
      .sort({ bucket: 1 })
      .lean();
  },
};
