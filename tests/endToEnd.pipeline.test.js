import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockCommercePipeline } from './helpers/mockCommercePipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { makeFakeWebsite, makeFakeUserRecord } from './helpers/fakeWebsite.js';


const OWNER_ID = '507f1f77bcf86cd799439011';
const WEBSITE_A = 'a1b2c3d4e5f60718';
const WEBSITE_B = 'bbbbccccddddeeee';
const BUCKET_TIMESTAMP = '2026-08-15T10:00:00.000Z';
const RANGE_FROM = '2026-08-01T00:00:00.000Z';
const RANGE_TO = '2026-08-20T00:00:00.000Z';

let server;
let baseUrl;
let token;

before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  token = signAuthToken({ _id: OWNER_ID, role: 'user' });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function post(pipeline, body) {
  return postAndProcess(baseUrl, { ...body, timestamp: BUCKET_TIMESTAMP }, pipeline);
}

function getReport(path, websiteId) {
  return fetch(`${baseUrl}/api/reports/${websiteId}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(
    async (res) => ({ status: res.status, body: await res.json() })
  );
}

function mockReportingOwnership(t, websiteIds = [WEBSITE_A]) {
  t.mock.method(userRepository, 'findById', async (id) => (id === OWNER_ID ? makeFakeUserRecord(OWNER_ID) : null));
  t.mock.method(websiteRepository, 'findByWebsiteIdAndOwner', async (websiteId, ownerId) =>
    websiteIds.includes(websiteId) && ownerId === OWNER_ID
      ? makeFakeWebsite({ websiteId, ownerId, currency: 'USD', status: 'active' })
      : null
  );
}

describe('End-to-end pipeline: product_view -> add_to_cart -> remove_from_cart -> add_to_cart -> checkout -> purchase', () => {
  test('the full funnel resolves through every phase and reports correctly via the real HTTP reporting API', async (t) => {
    const pipeline = setupMockCommercePipeline(t, { websiteId: WEBSITE_A });
    mockReportingOwnership(t);
    const { products, carts, cartItems, checkouts, orders, orderItems, visitors, sessions, analytics } = pipeline;

    const base = { websiteId: WEBSITE_A, anonymousId: 'anon-1', sessionId: 'sess-1' };

    const productViewRes = await post(pipeline, {
      ...base,
      event: 'product_view',
      data: { productId: 'p1', name: 'Widget', price: 50, currency: 'USD' },
    });
    assert.equal(productViewRes.res.status, 202);
    assert.equal(products.size, 1);
    assert.equal(products.get(`${WEBSITE_A}:p1`).name, 'Widget');

    await post(pipeline, {
      ...base,
      event: 'add_to_cart',
      data: { cartId: 'cart-1', productId: 'p1', name: 'Widget', price: 50, quantity: 2, currency: 'USD' },
    });
    assert.equal(carts.size, 1);
    assert.equal(carts.get(`${WEBSITE_A}:cart-1`).itemCount, 2);
    assert.equal(cartItems.get(`${WEBSITE_A}:cart-1:p1`).quantity, 2);

    await post(pipeline, {
      ...base,
      event: 'remove_from_cart',
      data: { cartId: 'cart-1', productId: 'p1', quantity: 1 },
    });
    assert.equal(carts.get(`${WEBSITE_A}:cart-1`).itemCount, 1);
    assert.equal(cartItems.get(`${WEBSITE_A}:cart-1:p1`).quantity, 1);

    await post(pipeline, {
      ...base,
      event: 'add_to_cart',
      data: { cartId: 'cart-1', productId: 'p1', name: 'Widget', price: 50, quantity: 1, currency: 'USD' },
    });
    assert.equal(carts.get(`${WEBSITE_A}:cart-1`).itemCount, 2);
    assert.equal(carts.get(`${WEBSITE_A}:cart-1`).subtotal, 10000);

    await post(pipeline, {
      ...base,
      event: 'checkout',
      data: {
        checkoutId: 'chk-1',
        cartId: 'cart-1',
        items: [{ productId: 'p1', name: 'Widget', price: 50, quantity: 2 }],
        cartValue: 100,
        currency: 'USD',
      },
    });
    assert.equal(checkouts.size, 1);
    assert.equal(checkouts.get(`${WEBSITE_A}:chk-1`).status, 'started');
    assert.equal(checkouts.get(`${WEBSITE_A}:chk-1`).total, 10000);

    await post(pipeline, {
      ...base,
      event: 'purchase',
      data: {
        orderId: 'order-1',
        checkoutId: 'chk-1',
        revenue: 100,
        currency: 'USD',
        items: [{ productId: 'p1', name: 'Widget', price: 50, quantity: 2 }],
      },
    });

    assert.equal(orders.size, 1);
    const order = orders.get(`${WEBSITE_A}:order-1`);
    assert.equal(order.total, 10000);
    assert.equal(order.currency, 'USD');
    assert.equal(Number.isInteger(order.total), true);
    assert.equal(orderItems.length, 1);
    assert.equal(orderItems[0].quantity, 2);
    assert.equal(orderItems[0].unitPrice, 5000);
    assert.equal(checkouts.get(`${WEBSITE_A}:chk-1`).status, 'completed');

    assert.equal(visitors.size, 1);
    assert.equal(sessions.size, 1);
    const visitor = visitors.get(`${WEBSITE_A}:anon-1`);
    assert.equal(visitor.eventCount, 6);

    const dayBucketKey = `${WEBSITE_A}:day:${new Date('2026-08-15T00:00:00.000Z').toISOString()}`;
    const dayBucket = analytics.buckets.get(dayBucketKey);
    assert.ok(dayBucket, 'a day bucket must exist for this website/date');
    assert.equal(dayBucket.productViews, 1);
    assert.equal(dayBucket.addToCarts, 2);
    assert.equal(dayBucket.removeFromCarts, 1);
    assert.equal(dayBucket.cartsCreated, 1);
    assert.equal(dayBucket.checkoutStarted, 1);
    assert.equal(dayBucket.checkoutCompleted, 1);
    assert.equal(dayBucket.orders, 1);
    assert.equal(dayBucket.unitsSold, 2);
    assert.equal(dayBucket.grossRevenueMinor, 10000);
    assert.equal(dayBucket.netRevenueMinor, 10000);

    const overview = await getReport(`/overview?from=${RANGE_FROM}&to=${RANGE_TO}`, WEBSITE_A);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.productViews, 1);
    assert.equal(overview.body.data.addToCart, 2);
    assert.equal(overview.body.data.removeFromCart, 1);
    assert.equal(overview.body.data.checkoutStarted, 1);
    assert.equal(overview.body.data.checkoutCompleted, 1);
    assert.equal(overview.body.data.orders, 1);
    assert.equal(overview.body.data.grossRevenue, 100);
    assert.equal(overview.body.data.netRevenue, 100);
    assert.equal(overview.body.data.uniqueVisitors, 1);
    assert.equal(overview.body.data.uniqueSessions, 1);
    assert.equal(overview.body.data.conversionRate, 100);

    const revenue = await getReport(`/revenue?from=${RANGE_FROM}&to=${RANGE_TO}`, WEBSITE_A);
    assert.equal(revenue.body.data.grossRevenue, 100);
    assert.equal(revenue.body.data.refundedAmount, 0);
    assert.equal(revenue.body.data.netRevenue, 100);
    assert.equal(revenue.body.data.orderCount, 1);
    assert.equal(revenue.body.data.averageOrderValue, 100);

    const products_ = await getReport(`/products?from=${RANGE_FROM}&to=${RANGE_TO}`, WEBSITE_A);
    assert.equal(products_.body.data.items.length, 1);
    assert.equal(products_.body.data.items[0].productId, 'p1');
    assert.equal(products_.body.data.items[0].revenue, 100);
    assert.equal(products_.body.data.items[0].purchaseQuantity, 2);

    const productDetail = await getReport(`/products/p1?from=${RANGE_FROM}&to=${RANGE_TO}`, WEBSITE_A);
    assert.equal(productDetail.status, 200);
    assert.equal(productDetail.body.data.productName, 'Widget');
    assert.equal(productDetail.body.data.orders, 1);
    assert.equal(productDetail.body.data.checkoutQuantity, null);

    const conversion = await getReport(`/conversion?from=${RANGE_FROM}&to=${RANGE_TO}`, WEBSITE_A);
    assert.equal(conversion.body.data.conversionRates.visitorConversionRate, 100);
    assert.equal(conversion.body.data.conversionRates.purchaseConversionRate, 100);

    const cartCheckout = await getReport(`/cart-checkout?from=${RANGE_FROM}&to=${RANGE_TO}`, WEBSITE_A);
    assert.equal(cartCheckout.body.data.cartsCreated, 1);
    assert.equal(cartCheckout.body.data.checkoutCompleted, 1);
    assert.equal(cartCheckout.body.data.cartValue, 150);
    assert.notEqual(cartCheckout.body.data.cartValue, revenue.body.data.grossRevenue);

    const timeseries = await getReport(`/timeseries?from=${RANGE_FROM}&to=${RANGE_TO}&granularity=day`, WEBSITE_A);
    assert.equal(timeseries.body.data.points.length, 1);
    assert.equal(timeseries.body.data.points[0].orders, 1);
  });

  test('resubmitting the same purchase event (duplicate eventId) does not double-count revenue or orders anywhere in the pipeline', async (t) => {
    const pipeline = setupMockCommercePipeline(t, { websiteId: WEBSITE_A });
    mockReportingOwnership(t);
    const { orders, analytics } = pipeline;

    const purchaseEvent = {
      websiteId: WEBSITE_A,
      event: 'purchase',
      eventId: 'fixed-event-id-dup',
      anonymousId: 'anon-2',
      timestamp: BUCKET_TIMESTAMP,
      data: { orderId: 'order-dup', revenue: 250, currency: 'USD', items: [{ productId: 'p2', price: 250, quantity: 1 }] },
    };

    const first = await postAndProcess(baseUrl, purchaseEvent, pipeline);
    assert.equal(first.res.status, 202);

    const second = await postAndProcess(baseUrl, purchaseEvent, pipeline);
    assert.equal(second.res.status, 200);
    assert.equal(second.body.data.duplicate, true);
    assert.equal(second.processingResult.reason, 'already_completed');

    assert.equal(orders.size, 1);

    const dayBucketKey = `${WEBSITE_A}:day:${new Date('2026-08-15T00:00:00.000Z').toISOString()}`;
    assert.equal(analytics.buckets.get(dayBucketKey).orders, 1);
    assert.equal(analytics.buckets.get(dayBucketKey).grossRevenueMinor, 25000);

    const revenue = await getReport(`/revenue?from=${RANGE_FROM}&to=${RANGE_TO}`, WEBSITE_A);
    assert.equal(revenue.body.data.orderCount, 1);
    assert.equal(revenue.body.data.grossRevenue, 250);
  });

  test('cross-tenant isolation holds end-to-end: a second website\'s purchase never appears in the first website\'s report', async (t) => {
    const pipeline = setupMockCommercePipeline(t, { websiteId: WEBSITE_A });
    mockReportingOwnership(t, [WEBSITE_A, WEBSITE_B]);

    const originalFindByWebsiteId = websiteRepository.findByWebsiteId;
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) => {
      if (id === WEBSITE_B) return makeFakeWebsite({ websiteId: WEBSITE_B, status: 'active' });
      return originalFindByWebsiteId(id);
    });

    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'purchase',
      anonymousId: 'anon-a',
      data: { orderId: 'order-a', revenue: 100, currency: 'USD', items: [{ productId: 'p1', price: 100, quantity: 1 }] },
    });
    await post(pipeline, {
      websiteId: WEBSITE_B,
      event: 'purchase',
      anonymousId: 'anon-b',
      data: { orderId: 'order-b', revenue: 9999, currency: 'USD', items: [{ productId: 'p9', price: 9999, quantity: 1 }] },
    });

    const revenueA = await getReport(`/revenue?from=${RANGE_FROM}&to=${RANGE_TO}`, WEBSITE_A);
    assert.equal(revenueA.body.data.grossRevenue, 100);
    assert.notEqual(revenueA.body.data.grossRevenue, 9999);

    const revenueB = await getReport(`/revenue?from=${RANGE_FROM}&to=${RANGE_TO}`, WEBSITE_B);
    assert.equal(revenueB.body.data.grossRevenue, 9999);
  });
});
