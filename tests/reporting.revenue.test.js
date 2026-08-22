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

describe('GET /api/reports/:websiteId/revenue', () => {
  test('returns gross revenue, order count, and average order value in major units', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({ bucket: new Date('2026-08-10T00:00:00.000Z'), orders: 4, grossRevenueMinor: 100000, refundedAmountMinor: 0, netRevenueMinor: 100000 });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/revenue?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.grossRevenue, 1000);
    assert.equal(body.data.orderCount, 4);
    assert.equal(body.data.averageOrderValue, 250); // 1000 / 4
    assert.equal(body.data.currency, 'USD');
  });

  test('net revenue correctly subtracts refunds', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({ bucket: new Date('2026-08-10T00:00:00.000Z'), orders: 2, grossRevenueMinor: 50000, refundedAmountMinor: 12000, netRevenueMinor: 38000 });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/revenue?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(body.data.grossRevenue, 500);
    assert.equal(body.data.refundedAmount, 120);
    assert.equal(body.data.netRevenue, 380);
  });

  test('sums revenue correctly across multiple buckets without floating-point drift', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    // 10 buckets of 33 minor units each — a classic float-accumulation
    // trap (0.1 + 0.1 + ... style) if summed as major-unit floats. Summed
    // as integer minor units, this must land exactly on 330 -> 3.3 major.
    for (let i = 0; i < 10; i += 1) {
      pipeline.seedBucket({ bucket: new Date(`2026-08-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`), orders: 1, grossRevenueMinor: 33, netRevenueMinor: 33 });
    }

    const res = await get(
      `/api/reports/${pipeline.websiteId}/revenue?from=2026-08-01T00:00:00.000Z&to=2026-08-25T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(body.data.grossRevenue, 3.3);
    assert.equal(body.data.orderCount, 10);
  });

  test('zero orders produces averageOrderValue 0, never NaN/Infinity', async (t) => {
    const pipeline = setupMockReportingPipeline(t);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/revenue?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.orderCount, 0);
    assert.equal(body.data.averageOrderValue, 0);
    assert.equal(JSON.stringify(body).includes('NaN'), false);
  });
});

describe('GET /api/reports/:websiteId/conversion', () => {
  test('exposes the funnel counts and all documented conversion rates', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({
      bucket: new Date('2026-08-10T00:00:00.000Z'),
      productViews: 200,
      addToCarts: 40,
      checkoutStarted: 20,
      checkoutCompleted: 10,
      orders: 10,
    });
    pipeline.seedVisitorClaim({ bucket: new Date('2026-08-10T00:00:00.000Z'), anonymousId: 'v1' });
    pipeline.seedVisitorClaim({ bucket: new Date('2026-08-10T00:00:00.000Z'), anonymousId: 'v2' });
    pipeline.seedSessionClaim({ bucket: new Date('2026-08-10T00:00:00.000Z'), sessionId: 's1' });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/conversion?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.productViews, 200);
    assert.equal(body.data.addToCart, 40);
    assert.equal(body.data.checkoutStarted, 20);
    assert.equal(body.data.checkoutCompleted, 10);
    assert.equal(body.data.orders, 10);
    assert.equal(body.data.uniqueVisitors, 2);
    assert.equal(body.data.uniqueSessions, 1);
    assert.equal(body.data.conversionRates.addToCartRate, 20); // 40/200*100
    assert.equal(body.data.conversionRates.visitorConversionRate, 500); // 10/2*100
    assert.equal(body.data.conversionRates.sessionConversionRate, 1000); // 10/1*100
    assert.equal(body.data.conversionRates.purchaseConversionRate, 50); // 10/20*100
  });

  test('an empty range safely zeroes every rate', async (t) => {
    const pipeline = setupMockReportingPipeline(t);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/conversion?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    for (const rate of Object.values(body.data.conversionRates)) {
      assert.equal(rate, 0);
    }
  });
});

describe('GET /api/reports/:websiteId/cart-checkout', () => {
  test('exposes cart/checkout activity, and cart value never contaminates revenue (§17)', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({
      bucket: new Date('2026-08-10T00:00:00.000Z'),
      addToCarts: 30,
      removeFromCarts: 5,
      cartsCreated: 12,
      cartItems: 30,
      cartQuantity: 45,
      cartValueMinor: 999900,
      checkoutStarted: 8,
      checkoutCompleted: 4,
      grossRevenueMinor: 40000, // deliberately different from cartValueMinor
    });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/cart-checkout?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.addToCart, 30);
    assert.equal(body.data.removeFromCart, 5);
    assert.equal(body.data.cartsCreated, 12);
    assert.equal(body.data.cartItems, 30);
    assert.equal(body.data.cartQuantity, 45);
    assert.equal(body.data.cartValue, 9999);
    assert.equal(body.data.checkoutStarted, 8);
    assert.equal(body.data.checkoutCompleted, 4);
    assert.equal(Object.prototype.hasOwnProperty.call(body.data, 'grossRevenue'), false); // not a revenue report
    assert.notEqual(body.data.cartValue, 400); // must never equal the (converted) revenue figure
    assert.equal(body.data.conversionRates.cartToCheckoutRate, calcRate(8, 12));
    assert.equal(body.data.conversionRates.checkoutCompletionRate, calcRate(4, 8));
  });

  test('zero carts created safely zeroes the cart-to-checkout rate', async (t) => {
    const pipeline = setupMockReportingPipeline(t);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/cart-checkout?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(body.data.conversionRates.cartToCheckoutRate, 0);
    assert.equal(body.data.conversionRates.checkoutCompletionRate, 0);
  });
});

function calcRate(numerator, denominator) {
  return Math.round((numerator / denominator) * 100 * 100) / 100;
}
