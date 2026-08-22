import { userRepository } from '../../src/repositories/user.repository.js';
import { websiteRepository } from '../../src/repositories/website.repository.js';
import { productRepository } from '../../src/repositories/product.repository.js';
import { analyticsRepository } from '../../src/repositories/analytics/analytics.repository.js';
import { productAnalyticsRepository } from '../../src/repositories/analytics/productAnalytics.repository.js';
import { visitorAnalyticsRepository } from '../../src/repositories/analytics/visitorAnalytics.repository.js';
import { sessionAnalyticsRepository } from '../../src/repositories/analytics/sessionAnalytics.repository.js';
import { signAuthToken } from '../../src/utils/jwt.js';
import { makeFakeWebsite, makeFakeUserRecord } from './fakeWebsite.js';

const BUCKET_COUNTER_FIELDS = [
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

const PRODUCT_COUNTER_FIELDS = ['productViews', 'addToCarts', 'removeFromCarts', 'unitsSold', 'orders', 'revenueMinor'];

function inRange(bucket, from, to) {
  return bucket.getTime() >= from.getTime() && bucket.getTime() < to.getTime();
}

function zeroed(fields) {
  return Object.fromEntries(fields.map((f) => [f, 0]));
}

// Realistic in-memory mock of the Phase 9 reporting repository methods
// (analyticsRepository.sumBucketsInRange/findBucketsInRange,
// productAnalyticsRepository.sumProductBucketsInRange/aggregateTopProducts,
// visitor/sessionAnalyticsRepository.countDistinctInRange) — mirrors the
// exact grouping/summing/sorting/pagination semantics the real MongoDB
// aggregation pipelines implement (src/repositories/analytics/*.js), so
// route -> controller -> service -> repository -> response tests exercise
// real correctness properties (multi-tenant isolation, date-range
// filtering, sorting, pagination) without live MongoDB. Production code
// itself is untouched real Mongoose aggregation — this mock exists only at
// the test boundary, same pattern as tests/helpers/mockAnalyticsRepositories.js
// (Phase 8) and every repository mock before it in this codebase.
//
// Tests seed data directly into the returned stores (seedBucket/
// seedProductBucket/seedVisitorClaim/seedSessionClaim) — this is
// independent of Phase 8's aggregation *writing* path, which already has
// its own dedicated test coverage; Phase 9 tests care about *reading* and
// reporting on aggregated data, not re-deriving how it got there.
export function setupMockReportingPipeline(t, { ownerId = 'user-1', websiteId = 'a1b2c3d4e5f60718', currency = 'USD' } = {}) {
  const buckets = []; // AnalyticsBucket-shaped plain objects
  const productBuckets = []; // ProductAnalyticsBucket-shaped plain objects
  const visitorClaims = []; // { websiteId, granularity, bucket, anonymousId }
  const sessionClaims = []; // { websiteId, granularity, bucket, sessionId }
  const websites = new Map(); // websiteId -> fake website record
  const products = new Map(); // `${websiteId}:${externalProductId}` -> fake product record

  websites.set(websiteId, makeFakeWebsite({ websiteId, ownerId, currency, status: 'active' }));

  t.mock.method(userRepository, 'findById', async (id) =>
    id === ownerId ? makeFakeUserRecord(ownerId) : null
  );
  t.mock.method(websiteRepository, 'findByWebsiteIdAndOwner', async (wId, oId) => {
    const site = websites.get(wId);
    return site && site.ownerId === oId ? { ...site } : null;
  });
  t.mock.method(productRepository, 'findByWebsiteAndExternalId', async (wId, externalProductId) =>
    products.get(`${wId}:${externalProductId}`) ?? null
  );

  t.mock.method(analyticsRepository, 'sumBucketsInRange', async (wId, granularity, from, to) => {
    const matches = buckets.filter((b) => b.websiteId === wId && b.granularity === granularity && inRange(b.bucket, from, to));
    const totals = zeroed(BUCKET_COUNTER_FIELDS);
    for (const b of matches) {
      for (const field of BUCKET_COUNTER_FIELDS) totals[field] += b[field] ?? 0;
    }
    return totals;
  });

  t.mock.method(analyticsRepository, 'findBucketsInRange', async (wId, granularity, from, to) =>
    buckets
      .filter((b) => b.websiteId === wId && b.granularity === granularity && inRange(b.bucket, from, to))
      .sort((a, b) => a.bucket.getTime() - b.bucket.getTime())
      .map((b) => ({ ...b }))
  );

  t.mock.method(visitorAnalyticsRepository, 'countDistinctInRange', async (wId, granularity, from, to) => {
    const matches = visitorClaims.filter((c) => c.websiteId === wId && c.granularity === granularity && inRange(c.bucket, from, to));
    return new Set(matches.map((c) => c.anonymousId)).size;
  });

  t.mock.method(sessionAnalyticsRepository, 'countDistinctInRange', async (wId, granularity, from, to) => {
    const matches = sessionClaims.filter((c) => c.websiteId === wId && c.granularity === granularity && inRange(c.bucket, from, to));
    return new Set(matches.map((c) => c.sessionId)).size;
  });

  t.mock.method(productAnalyticsRepository, 'sumProductBucketsInRange', async (wId, productId, granularity, from, to) => {
    const matches = productBuckets
      .filter((p) => p.websiteId === wId && p.productId === productId && p.granularity === granularity && inRange(p.bucket, from, to))
      .sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
    const totals = zeroed(PRODUCT_COUNTER_FIELDS);
    let productName;
    for (const p of matches) {
      for (const field of PRODUCT_COUNTER_FIELDS) totals[field] += p[field] ?? 0;
      if (p.productNameSnapshot !== undefined) productName = p.productNameSnapshot;
    }
    return { productName, ...totals };
  });

  t.mock.method(productAnalyticsRepository, 'aggregateTopProducts', async (wId, granularity, from, to, { sortField, sortOrder, skip, limit }) => {
    const matches = productBuckets
      .filter((p) => p.websiteId === wId && p.granularity === granularity && inRange(p.bucket, from, to))
      .sort((a, b) => a.bucket.getTime() - b.bucket.getTime());

    const grouped = new Map(); // productId -> accumulator
    for (const p of matches) {
      let acc = grouped.get(p.productId);
      if (!acc) {
        acc = { _id: p.productId, productName: undefined, ...zeroed(PRODUCT_COUNTER_FIELDS) };
        grouped.set(p.productId, acc);
      }
      for (const field of PRODUCT_COUNTER_FIELDS) acc[field] += p[field] ?? 0;
      if (p.productNameSnapshot !== undefined) acc.productName = p.productNameSnapshot;
    }

    const items = [...grouped.values()].sort((a, b) => {
      if (a[sortField] === b[sortField]) return a._id < b._id ? -1 : 1;
      return sortOrder === 1 ? a[sortField] - b[sortField] : b[sortField] - a[sortField];
    });

    return { items: items.slice(skip, skip + limit).map((i) => ({ ...i })), total: items.length };
  });

  return {
    websiteId,
    ownerId,
    token: signAuthToken({ _id: ownerId, role: 'user' }),
    websites,
    products,
    buckets,
    productBuckets,
    visitorClaims,
    sessionClaims,

    // --- seed helpers ------------------------------------------------
    seedBucket(overrides) {
      const doc = { websiteId, granularity: 'day', currency, ...zeroed(BUCKET_COUNTER_FIELDS), ...overrides };
      buckets.push(doc);
      return doc;
    },
    seedProductBucket(overrides) {
      const doc = { websiteId, granularity: 'day', ...zeroed(PRODUCT_COUNTER_FIELDS), ...overrides };
      productBuckets.push(doc);
      return doc;
    },
    seedVisitorClaim(overrides) {
      const doc = { websiteId, granularity: 'day', ...overrides };
      visitorClaims.push(doc);
      return doc;
    },
    seedSessionClaim(overrides) {
      const doc = { websiteId, granularity: 'day', ...overrides };
      sessionClaims.push(doc);
      return doc;
    },
    seedWebsite(wId, overrides) {
      websites.set(wId, makeFakeWebsite({ websiteId: wId, ownerId, currency, status: 'active', ...overrides }));
    },
    seedProduct(wId, externalProductId, overrides) {
      products.set(`${wId}:${externalProductId}`, { websiteId: wId, externalProductId, name: 'Product', ...overrides });
    },
  };
}
