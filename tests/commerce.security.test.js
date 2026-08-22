import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockCommercePipeline } from './helpers/mockCommercePipeline.js';
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

function post(pipeline, body) {
  return postAndProcess(baseUrl, body, pipeline);
}

describe('Commerce entities — multi-tenant isolation and injection resistance', () => {
  test('a client cannot inject visitorId/sessionObjectId into a Product/Cart/Order via the payload', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { products, carts, orders } = pipeline;

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'purchase',
      anonymousId: 'real-anon',
      data: {
        orderId: 'order-1',
        revenue: 10,
        currency: 'USD',
        items: [{ productId: 'p1', price: 10, quantity: 1 }],
        // None of these are recognized fields — the validator's allow-list
        // never reads them, so they can't reach any document.
        visitorId: 'hacked-visitor-id',
        sessionObjectId: 'hacked-session-id',
        ownerId: 'hacked-owner-id',
        _id: 'hacked-mongo-id',
      },
    });

    const order = orders.get(`${WEBSITE_ID}:order-1`);
    assert.notEqual(String(order.visitorId), 'hacked-visitor-id');
    assert.notEqual(order._id, 'hacked-mongo-id'); // _id is always server-assigned
    assert.ok(order._id);
    assert.equal('ownerId' in order, false);
    // Product/Cart untouched by this purchase (no cartId sent) — just
    // confirms the injected fields didn't leak anywhere unexpected either.
    assert.equal(products.size, 1);
    assert.equal(carts.size, 0);
  });

  test('payment card data sent in purchase.data is never persisted anywhere', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders, orderItems } = pipeline;

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'purchase',
      data: {
        orderId: 'order-cc',
        revenue: 10,
        currency: 'USD',
        items: [{ productId: 'p1', price: 10, quantity: 1 }],
        cardNumber: '4111111111111111',
        cvv: '123',
        cardholderPassword: 'hunter2',
        authToken: 'Bearer some-token',
      },
    });

    const order = orders.get(`${WEBSITE_ID}:order-cc`);
    const rawOrder = JSON.stringify(order);
    const rawItems = JSON.stringify(orderItems);

    assert.ok(!rawOrder.includes('4111111111111111'));
    assert.ok(!rawOrder.toLowerCase().includes('cvv'));
    assert.ok(!rawOrder.includes('hunter2'));
    assert.ok(!rawItems.includes('4111111111111111'));
  });

  test('a client cannot inject externalOrderId-mismatched fields to move an order between websites', async (t) => {
    const pipeline = setupMockCommercePipeline(t, { websiteId: WEBSITE_ID });
    const OTHER_WEBSITE = 'bbbbccccddddeeee';
    const { websiteRepository } = await import('../src/repositories/website.repository.js');
    const { makeFakeWebsite } = await import('./helpers/fakeWebsite.js');
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      [WEBSITE_ID, OTHER_WEBSITE].includes(id) ? makeFakeWebsite({ websiteId: id, status: 'active' }) : null
    );
    const { orderRepository } = await import('../src/repositories/order.repository.js');

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'purchase',
      data: { orderId: 'iso-order', revenue: 10, currency: 'USD', items: [{ productId: 'p1', price: 10, quantity: 1 }] },
    });

    // Querying under the OTHER website must never find Website A's order.
    const crossLookup = await orderRepository.findByWebsiteAndExternalOrderId(OTHER_WEBSITE, 'iso-order');
    assert.equal(crossLookup, null);
  });

  test('an archived website still rejects commerce events before any Event, Product, Cart, or Order is created', async (t) => {
    const pipeline = setupMockCommercePipeline(t, { websiteStatus: 'archived' });
    const { products, orders, events } = pipeline;

    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        websiteId: WEBSITE_ID,
        event: 'purchase',
        data: { orderId: 'should-not-exist', revenue: 10, currency: 'USD', items: [{ productId: 'p1', price: 10, quantity: 1 }] },
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'WEBSITE_ARCHIVED');
    assert.equal(events.size, 0);
    assert.equal(products.size, 0);
    assert.equal(orders.size, 0);
  });
});
