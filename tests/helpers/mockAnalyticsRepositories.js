import { analyticsRepository } from '../../src/repositories/analytics/analytics.repository.js';
import { productAnalyticsRepository } from '../../src/repositories/analytics/productAnalytics.repository.js';
import { visitorAnalyticsRepository } from '../../src/repositories/analytics/visitorAnalytics.repository.js';
import { sessionAnalyticsRepository } from '../../src/repositories/analytics/sessionAnalytics.repository.js';
import { analyticsEventProcessedRepository } from '../../src/repositories/analytics/analyticsEventProcessed.repository.js';

const BASE_BUCKET_COUNTERS = {
  pageViews: 0,
  uniqueVisitors: 0,
  uniqueSessions: 0,
  productViews: 0,
  addToCarts: 0,
  removeFromCarts: 0,
  cartsCreated: 0,
  cartItems: 0,
  cartQuantity: 0,
  cartValueMinor: 0,
  checkoutStarted: 0,
  checkoutCompleted: 0,
  orders: 0,
  unitsSold: 0,
  grossRevenueMinor: 0,
  refundedAmountMinor: 0,
  netRevenueMinor: 0,
};

// Mirrors src/repositories/analytics/analytics.repository.js's
// SUMMABLE_COUNTER_FIELDS exactly (uniqueVisitors/uniqueSessions
// deliberately excluded — see that file's comment: summing per-bucket
// unique counts across a range would over-count a visitor/session active
// in more than one bucket; true range-wide distinct counts come from
// countDistinctInRange below instead).
const SUMMABLE_BUCKET_FIELDS = Object.keys(BASE_BUCKET_COUNTERS).filter(
  (f) => f !== 'uniqueVisitors' && f !== 'uniqueSessions'
);

const BASE_PRODUCT_COUNTERS = {
  productViews: 0,
  addToCarts: 0,
  removeFromCarts: 0,
  unitsSold: 0,
  orders: 0,
  revenueMinor: 0,
};

function inRange(bucket, from, to) {
  return bucket.getTime() >= from.getTime() && bucket.getTime() < to.getTime();
}

function zeroed(fields) {
  return Object.fromEntries(fields.map((f) => [f, 0]));
}

// Full-fidelity in-memory mock of the ENTIRE Phase 8/9 analytics
// repository layer — both the WRITE side (incrementBucket,
// incrementProductBucket, claim, the idempotency marker — Phase 8) and
// the READ side (sumBucketsInRange, findBucketsInRange,
// countDistinctInRange, sumProductBucketsInRange, aggregateTopProducts —
// Phase 9), all operating over ONE shared in-memory store. This is what
// makes it possible to run a realistic event through the REAL aggregation
// write path (analyticsAggregationService) and then query the REAL
// reporting read path (reportingService) and see consistent numbers —
// exactly the full-pipeline proof Phase 12's end-to-end test needs.
//
// tests/helpers/mockReportingPipeline.js remains separate and is still
// used by Phase 9's own reporting tests, which deliberately seed exact
// bucket values directly (skipping the write path entirely) to test
// reporting math in isolation — a different, equally valid testing style
// for a different purpose. Both coexist; neither replaces the other.
//
// Each mocked method does its read-modify-write in a single synchronous
// block (no `await` between reading and writing the record) — this is
// deliberate, not an accident of convenience: it's what makes a
// Promise.all of many concurrent calls behave the same way a real MongoDB
// atomic $inc would (§22/§23), since Node's single-threaded event loop
// never interleaves two synchronous sections. A mock that used
// find-then-await-then-save here would let concurrent calls race and lose
// updates, which is exactly the bug this architecture (atomic
// findOneAndUpdate + $inc) exists to prevent in production.
export function mockAnalyticsRepositories(t) {
  const buckets = new Map(); // `${websiteId}:${granularity}:${bucketISO}` -> bucket doc
  const productBuckets = new Map(); // `${websiteId}:${productId}:${granularity}:${bucketISO}` -> doc
  const visitorClaims = new Map(); // `${websiteId}:${granularity}:${bucketISO}:${anonymousId}` -> { websiteId, granularity, bucket, anonymousId }
  const sessionClaims = new Map(); // `${websiteId}:${granularity}:${bucketISO}:${sessionId}` -> { websiteId, granularity, bucket, sessionId }
  const processedEvents = new Set(); // `${websiteId}:${eventId}`
  const releasedEvents = []; // every (websiteId, eventId) release() was called for, in order

  // --- Write side (Phase 8) ------------------------------------------------

  t.mock.method(analyticsRepository, 'incrementBucket', async (websiteId, granularity, bucket, currency, inc) => {
    const key = `${websiteId}:${granularity}:${bucket.toISOString()}`;
    let doc = buckets.get(key);
    if (!doc) {
      doc = { websiteId, granularity, bucket, currency, ...BASE_BUCKET_COUNTERS };
      buckets.set(key, doc);
    }
    if (currency) doc.currency = currency;
    for (const [field, delta] of Object.entries(inc)) {
      doc[field] = (doc[field] ?? 0) + delta;
    }
    return { ...doc };
  });

  t.mock.method(
    productAnalyticsRepository,
    'incrementProductBucket',
    async (websiteId, productId, granularity, bucket, productName, inc) => {
      const key = `${websiteId}:${productId}:${granularity}:${bucket.toISOString()}`;
      let doc = productBuckets.get(key);
      if (!doc) {
        doc = { websiteId, productId, granularity, bucket, productNameSnapshot: productName, ...BASE_PRODUCT_COUNTERS };
        productBuckets.set(key, doc);
      }
      if (productName !== undefined) doc.productNameSnapshot = productName;
      for (const [field, delta] of Object.entries(inc)) {
        doc[field] = (doc[field] ?? 0) + delta;
      }
      return { ...doc };
    }
  );

  t.mock.method(visitorAnalyticsRepository, 'claim', async (websiteId, granularity, bucket, anonymousId) => {
    const key = `${websiteId}:${granularity}:${bucket.toISOString()}:${anonymousId}`;
    if (visitorClaims.has(key)) return false;
    visitorClaims.set(key, { websiteId, granularity, bucket, anonymousId });
    return true;
  });

  t.mock.method(sessionAnalyticsRepository, 'claim', async (websiteId, granularity, bucket, sessionId) => {
    const key = `${websiteId}:${granularity}:${bucket.toISOString()}:${sessionId}`;
    if (sessionClaims.has(key)) return false;
    sessionClaims.set(key, { websiteId, granularity, bucket, sessionId });
    return true;
  });

  t.mock.method(analyticsEventProcessedRepository, 'claim', async (websiteId, eventId) => {
    const key = `${websiteId}:${eventId}`;
    if (processedEvents.has(key)) return null;
    processedEvents.add(key);
    return { websiteId, eventId, processedAt: new Date() };
  });

  t.mock.method(analyticsEventProcessedRepository, 'release', async (websiteId, eventId) => {
    processedEvents.delete(`${websiteId}:${eventId}`);
    releasedEvents.push({ websiteId, eventId });
  });

  // --- Read side (Phase 9) — same store as above ---------------------------

  t.mock.method(analyticsRepository, 'sumBucketsInRange', async (websiteId, granularity, from, to) => {
    const totals = zeroed(SUMMABLE_BUCKET_FIELDS);
    for (const doc of buckets.values()) {
      if (doc.websiteId === websiteId && doc.granularity === granularity && inRange(doc.bucket, from, to)) {
        for (const field of SUMMABLE_BUCKET_FIELDS) totals[field] += doc[field] ?? 0;
      }
    }
    return totals;
  });

  t.mock.method(analyticsRepository, 'findBucketsInRange', async (websiteId, granularity, from, to) =>
    [...buckets.values()]
      .filter((doc) => doc.websiteId === websiteId && doc.granularity === granularity && inRange(doc.bucket, from, to))
      .sort((a, b) => a.bucket.getTime() - b.bucket.getTime())
      .map((doc) => ({ ...doc }))
  );

  t.mock.method(visitorAnalyticsRepository, 'countDistinctInRange', async (websiteId, granularity, from, to) => {
    const distinct = new Set();
    for (const claim of visitorClaims.values()) {
      if (claim.websiteId === websiteId && claim.granularity === granularity && inRange(claim.bucket, from, to)) {
        distinct.add(claim.anonymousId);
      }
    }
    return distinct.size;
  });

  t.mock.method(sessionAnalyticsRepository, 'countDistinctInRange', async (websiteId, granularity, from, to) => {
    const distinct = new Set();
    for (const claim of sessionClaims.values()) {
      if (claim.websiteId === websiteId && claim.granularity === granularity && inRange(claim.bucket, from, to)) {
        distinct.add(claim.sessionId);
      }
    }
    return distinct.size;
  });

  t.mock.method(
    productAnalyticsRepository,
    'sumProductBucketsInRange',
    async (websiteId, productId, granularity, from, to) => {
      const matches = [...productBuckets.values()]
        .filter(
          (doc) =>
            doc.websiteId === websiteId &&
            doc.productId === productId &&
            doc.granularity === granularity &&
            inRange(doc.bucket, from, to)
        )
        .sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
      const totals = zeroed(Object.keys(BASE_PRODUCT_COUNTERS));
      let productName;
      for (const doc of matches) {
        for (const field of Object.keys(BASE_PRODUCT_COUNTERS)) totals[field] += doc[field] ?? 0;
        if (doc.productNameSnapshot !== undefined) productName = doc.productNameSnapshot;
      }
      return { productName, ...totals };
    }
  );

  t.mock.method(
    productAnalyticsRepository,
    'aggregateTopProducts',
    async (websiteId, granularity, from, to, { sortField, sortOrder, skip, limit }) => {
      const matches = [...productBuckets.values()]
        .filter((doc) => doc.websiteId === websiteId && doc.granularity === granularity && inRange(doc.bucket, from, to))
        .sort((a, b) => a.bucket.getTime() - b.bucket.getTime());

      const grouped = new Map();
      for (const doc of matches) {
        let acc = grouped.get(doc.productId);
        if (!acc) {
          acc = { _id: doc.productId, productName: undefined, ...zeroed(Object.keys(BASE_PRODUCT_COUNTERS)) };
          grouped.set(doc.productId, acc);
        }
        for (const field of Object.keys(BASE_PRODUCT_COUNTERS)) acc[field] += doc[field] ?? 0;
        if (doc.productNameSnapshot !== undefined) acc.productName = doc.productNameSnapshot;
      }

      const items = [...grouped.values()].sort((a, b) => {
        if (a[sortField] === b[sortField]) return a._id < b._id ? -1 : 1;
        return sortOrder === 1 ? a[sortField] - b[sortField] : b[sortField] - a[sortField];
      });

      return { items: items.slice(skip, skip + limit).map((i) => ({ ...i })), total: items.length };
    }
  );

  return { buckets, productBuckets, visitorClaims, sessionClaims, processedEvents, releasedEvents };
}
