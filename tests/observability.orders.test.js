import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockObservabilityPipeline } from './helpers/mockObservabilityPipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';

const WEBSITE_ID = 'a1b2c3d4e5f60718';

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

function buildPurchase(overrides = {}) {
  const base = {
    websiteId: WEBSITE_ID,
    event: 'purchase',
    anonymousId: 'anon-1',
    sessionId: 'sess-1',
    data: {
      orderId: 'order-1',
      revenue: 850,
      currency: 'USD',
      items: [{ productId: 'p1', name: 'Laptop', price: 850, quantity: 1 }],
    },
  };
  return { ...base, ...overrides, data: { ...base.data, ...(overrides.data ?? {}) } };
}

describe('GET /api/reports/:websiteId/orders', () => {
  test('lists orders with the documented public fields (external id, never Mongo _id)', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, buildPurchase(), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/orders`, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.items.length, 1);
    const order = body.data.items[0];
    assert.equal(order.orderId, 'order-1');
    assert.equal(order.orderStatus, 'pending');
    assert.equal(order.paymentStatus, 'pending');
    assert.equal(order.currency, 'USD');
    assert.equal(order.total, 850);
    assert.equal(order.itemCount, 1);
    assert.equal(typeof order.orderCreatedAt, 'string');
    assert.equal(typeof order.purchasedAt, 'string');
    for (const forbidden of ['_id', 'id', 'cardNumber', 'cvv', 'paymentToken']) {
      assert.equal(Object.prototype.hasOwnProperty.call(order, forbidden), false);
    }
  });

  test('paginates and sorts by total', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, buildPurchase({ data: { orderId: 'order-a', revenue: 10 } }), pipeline);
    await postAndProcess(baseUrl, buildPurchase({ data: { orderId: 'order-b', revenue: 999 } }), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/orders?sort=total&order=desc`, pipeline.token);
    const body = await res.json();
    assert.deepEqual(body.data.items.map((o) => o.orderId), ['order-b', 'order-a']);
    assert.deepEqual(body.data.pagination, { page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  test('rejects an unrecognized sort field', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/orders?sort=__proto__`, pipeline.token);
    assert.equal(res.status, 400);
  });

  test('requires authentication', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/orders`);
    assert.equal(res.status, 401);
  });

  test('website isolation: an order under website B never appears in website A\'s list', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    pipeline.seedWebsite('bbbbbbbbbbbbbbbb', {});
    await postAndProcess(baseUrl, buildPurchase(), pipeline);
    await postAndProcess(baseUrl, buildPurchase({ websiteId: 'bbbbbbbbbbbbbbbb', data: { orderId: 'other-site-order' } }), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/orders`, pipeline.token);
    const body = await res.json();
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].orderId, 'order-1');
  });
});

describe('GET /api/reports/:websiteId/orders/:orderId', () => {
  test('returns order detail with items, historical prices, and linked visitor/session', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, buildPurchase(), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/orders/order-1`, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.orderId, 'order-1');
    assert.equal(body.data.total, 850);
    assert.equal(body.data.visitorId, 'anon-1');
    assert.equal(body.data.sessionId, 'sess-1');
    assert.equal(body.data.items.length, 1);
    const item = body.data.items[0];
    assert.equal(item.productId, 'p1');
    assert.equal(item.productName, 'Laptop');
    assert.equal(item.unitPrice, 850);
    assert.equal(item.quantity, 1);
  });

  test('links the checkout when the purchase event carried a checkoutId', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(
      baseUrl,
      {
        websiteId: WEBSITE_ID,
        event: 'checkout',
        anonymousId: 'anon-1',
        sessionId: 'sess-1',
        data: { items: [{ productId: 'p1', name: 'Laptop', price: 850, quantity: 1 }], cartValue: 850, currency: 'USD', checkoutId: 'chk-1' },
      },
      pipeline
    );
    await postAndProcess(baseUrl, buildPurchase({ data: { checkoutId: 'chk-1' } }), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/orders/order-1`, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.ok(body.data.linkedCheckout);
    assert.equal(body.data.linkedCheckout.checkoutId, 'chk-1');
  });

  test('linkedCheckout is null (not an error) when no checkout was linked', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, buildPurchase(), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/orders/order-1`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.linkedCheckout, null);
  });

  test('a nonexistent orderId returns 404 ORDER_NOT_FOUND', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/orders/does-not-exist`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'ORDER_NOT_FOUND');
  });

  test('an oversized orderId is rejected before any lookup', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/orders/${'x'.repeat(300)}`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_ORDER_ID');
  });

  test('the same externalOrderId under a different website is isolated', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    pipeline.seedWebsite('bbbbbbbbbbbbbbbb', {});
    await postAndProcess(baseUrl, buildPurchase(), pipeline);

    const res = await get('/api/reports/bbbbbbbbbbbbbbbb/orders/order-1', pipeline.token);
    assert.equal(res.status, 404);
  });
});
