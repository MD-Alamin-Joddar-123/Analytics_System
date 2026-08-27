import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockReportingPipeline } from './helpers/mockReportingPipeline.js';

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function get(path, token) {
  return fetch(`${baseUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

describe('GET /api/reports/:websiteId/overview', () => {
  test('returns correct summed metrics and a correctly computed conversion rate', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({
      granularity: 'day',
      bucket: new Date('2026-08-10T00:00:00.000Z'),
      pageViews: 100,
      productViews: 40,
      addToCarts: 20,
      removeFromCarts: 5,
      checkoutStarted: 10,
      checkoutCompleted: 8,
      orders: 8,
      grossRevenueMinor: 80000,
      refundedAmountMinor: 5000,
      netRevenueMinor: 75000,
    });
    pipeline.seedBucket({
      granularity: 'day',
      bucket: new Date('2026-08-11T00:00:00.000Z'),
      pageViews: 50,
      orders: 2,
      grossRevenueMinor: 20000,
      netRevenueMinor: 20000,
    });
    pipeline.seedVisitorClaim({ granularity: 'day', bucket: new Date('2026-08-10T00:00:00.000Z'), anonymousId: 'v1' });
    pipeline.seedVisitorClaim({ granularity: 'day', bucket: new Date('2026-08-11T00:00:00.000Z'), anonymousId: 'v1' });
    pipeline.seedVisitorClaim({ granularity: 'day', bucket: new Date('2026-08-10T00:00:00.000Z'), anonymousId: 'v2' });
    pipeline.seedSessionClaim({ granularity: 'day', bucket: new Date('2026-08-10T00:00:00.000Z'), sessionId: 's1' });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/overview?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.pageViews, 150);
    assert.equal(body.data.productViews, 40);
    assert.equal(body.data.addToCart, 20);
    assert.equal(body.data.removeFromCart, 5);
    assert.equal(body.data.checkoutStarted, 10);
    assert.equal(body.data.checkoutCompleted, 8);
    assert.equal(body.data.orders, 10);
    assert.equal(body.data.grossRevenue, 1000);
    assert.equal(body.data.refundedAmount, 50);
    assert.equal(body.data.netRevenue, 950);
    assert.equal(body.data.uniqueVisitors, 2);
    assert.equal(body.data.uniqueSessions, 1);
    assert.equal(body.data.conversionRate, 500);
    assert.equal(body.data.currency, 'USD');
  });

  test('an empty range (no buckets at all) returns an all-zero report, not an error', async (t) => {
    const pipeline = setupMockReportingPipeline(t);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/overview?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.pageViews, 0);
    assert.equal(body.data.orders, 0);
    assert.equal(body.data.grossRevenue, 0);
    assert.equal(body.data.uniqueVisitors, 0);
  });

  test('zero uniqueVisitors safely produces conversionRate 0, never NaN/Infinity', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({ bucket: new Date('2026-08-10T00:00:00.000Z'), orders: 5 });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/overview?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.conversionRate, 0);
    assert.notEqual(body.data.conversionRate, Infinity);
    assert.equal(JSON.stringify(body).includes('NaN'), false);
  });

  test('date filtering: a bucket outside the requested range is excluded', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({ bucket: new Date('2026-08-10T00:00:00.000Z'), pageViews: 100 });
    pipeline.seedBucket({ bucket: new Date('2025-01-01T00:00:00.000Z'), pageViews: 999 });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/overview?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(body.data.pageViews, 100);
  });

  test('multi-tenant isolation: two websites with data in the same range never mix', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { websiteId: 'aaaaaaaaaaaaaaaa' });
    pipeline.seedWebsite('bbbbbbbbbbbbbbbb', {});
    pipeline.seedBucket({ websiteId: 'aaaaaaaaaaaaaaaa', bucket: new Date('2026-08-10T00:00:00.000Z'), pageViews: 100, grossRevenueMinor: 10000 });
    pipeline.seedBucket({ websiteId: 'bbbbbbbbbbbbbbbb', bucket: new Date('2026-08-10T00:00:00.000Z'), pageViews: 5, grossRevenueMinor: 500 });

    const resA = await get('/api/reports/aaaaaaaaaaaaaaaa/overview?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z', pipeline.token);
    const bodyA = await resA.json();
    assert.equal(bodyA.data.pageViews, 100);
    assert.equal(bodyA.data.grossRevenue, 100);

    const resB = await get('/api/reports/bbbbbbbbbbbbbbbb/overview?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z', pipeline.token);
    const bodyB = await resB.json();
    assert.equal(bodyB.data.pageViews, 5);
    assert.equal(bodyB.data.grossRevenue, 5);
  });
});
