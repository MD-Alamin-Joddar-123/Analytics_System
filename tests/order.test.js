import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockCommercePipeline } from './helpers/mockCommercePipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';
import { eventProcessingService } from '../src/services/event/eventProcessing.service.js';

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

const purchaseEvent = (overrides = {}) => ({
  websiteId: WEBSITE_ID,
  event: 'purchase',
  anonymousId: 'anon-1',
  sessionId: 'sess-1',
  data: {
    orderId: 'order-1',
    revenue: 850,
    currency: 'BDT',
    items: [{ productId: 'p1', name: 'Laptop', price: 850, quantity: 1 }],
    ...overrides,
  },
});

describe('Order / OrderItem — purchase', () => {
  test('a purchase creates an Order with total in integer minor units', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders } = pipeline;

    const { res } = await post(pipeline, purchaseEvent());

    assert.equal(res.status, 202);
    assert.equal(orders.size, 1);
    const order = orders.get(`${WEBSITE_ID}:order-1`);
    assert.equal(order.total, 85000); // 850 BDT -> integer minor units
    assert.equal(Number.isInteger(order.total), true);
    assert.equal(order.currency, 'BDT');
  });

  test('the order is linked to the resolved visitor and session', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders, visitors } = pipeline;

    await post(pipeline, purchaseEvent());

    const order = orders.get(`${WEBSITE_ID}:order-1`);
    const visitor = visitors.get(`${WEBSITE_ID}:anon-1`);
    assert.equal(String(order.visitorId), String(visitor._id));
    assert.equal(order.anonymousId, 'anon-1');
    assert.equal(order.sessionId, 'sess-1');
  });

  test('OrderItems are created with historical unit prices preserved', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders, orderItems, products } = pipeline;

    // Product already exists, priced at 1000 (current price) today...
    await post(pipeline, { websiteId: WEBSITE_ID, event: 'product_view', data: { productId: 'p1', price: 1000, currency: 'BDT' } });
    assert.equal(products.get(`${WEBSITE_ID}:p1`).price, 100000);

    // ...but this historical order was placed at 850.
    await post(pipeline, purchaseEvent({ items: [{ productId: 'p1', name: 'Laptop', price: 850, quantity: 1 }] }));

    const order = orders.get(`${WEBSITE_ID}:order-1`);
    const items = orderItems.filter((oi) => String(oi.orderId) === String(order._id));
    assert.equal(items.length, 1);
    assert.equal(items[0].unitPrice, 85000); // 850, NOT today's 1000
    assert.equal(items[0].quantity, 1);
    assert.equal(items[0].subtotal, 85000);
  });

  test('purchase also resolves/creates products for each item, even without prior product_view', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { products } = pipeline;

    await post(pipeline, purchaseEvent({ items: [{ productId: 'never-viewed', price: 10, quantity: 1 }] }));

    assert.ok(products.has(`${WEBSITE_ID}:never-viewed`));
  });
});

describe('Order idempotency (websiteId + externalOrderId)', () => {
  test('resubmitting the identical purchase event (same eventId) does not duplicate the order or items', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders, orderItems } = pipeline;
    const payload = { ...purchaseEvent(), eventId: 'fixed-event-id' };

    const { res: firstRes } = await post(pipeline, payload);
    assert.equal(firstRes.status, 202);
    const { res: secondRes, body: secondBody } = await post(pipeline, payload);
    assert.equal(secondRes.status, 200);
    assert.equal(secondBody.data.duplicate, true);

    assert.equal(orders.size, 1);
    assert.equal(orderItems.length, 1);
  });

  test('two DIFFERENT events for the same externalOrderId still produce only one Order (upsert, not duplicate)', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders } = pipeline;

    // Simulates two distinct webhook deliveries for the same order — e.g.
    // a "pending" notification followed by a "paid" one — with different
    // eventIds, which Phase 4/5's event-level idempotency alone would NOT
    // catch (different eventId each time). Order-level idempotency (§12)
    // is what prevents a second Order document here.
    await post(pipeline, purchaseEvent({ orderId: 'order-evolving' }));
    const { res: res2 } = await post(pipeline, purchaseEvent({ orderId: 'order-evolving', paymentStatus: 'paid' }));

    assert.equal(res2.status, 202); // a genuinely new event, accepted
    assert.equal(orders.size, 1); // but still exactly one order
    assert.equal(orders.get(`${WEBSITE_ID}:order-evolving`).paymentStatus, 'paid');
  });

  test('that same non-identical-event re-purchase does NOT duplicate OrderItems', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orderItems } = pipeline;

    await post(pipeline, purchaseEvent({ orderId: 'order-evolving-2' }));
    await post(pipeline, purchaseEvent({ orderId: 'order-evolving-2', paymentStatus: 'paid' }));

    const itemsForThisOrder = orderItems.filter((oi) => oi.externalProductId === 'p1');
    // Exactly one line item was ever created for this order — the second
    // (update) pass never re-creates OrderItems, by design (§12).
    assert.equal(itemsForThisOrder.length, 1);
  });

  test('a race between two concurrent purchase processing runs for the same externalOrderId creates exactly one order', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders, orderItems, events } = pipeline;

    // Two DIFFERENT events (different eventIds), same externalOrderId —
    // ingest both first (independent, no race there), then process both
    // jobs concurrently to actually exercise the race in order.service.js.
    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purchaseEvent({ orderId: 'race-order' })),
      }),
      fetch(`${baseUrl}/api/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...purchaseEvent({ orderId: 'race-order' }), eventId: 'different-event-id-for-race' }),
      }),
    ]);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);

    const docA = events.get(`${WEBSITE_ID}:${bodyA.data.eventId}`);
    const docB = events.get(`${WEBSITE_ID}:${bodyB.data.eventId}`);
    await Promise.all([
      eventProcessingService.processEvent(docA._id),
      eventProcessingService.processEvent(docB._id),
    ]);

    assert.equal(orders.size, 1);
    // Exactly one of the two competing requests created the items.
    const items = orderItems.filter((oi) => String(oi.orderId) === String(orders.get(`${WEBSITE_ID}:race-order`)._id));
    assert.equal(items.length, 1);
  });

  test('purchase idempotency is per-website: the same externalOrderId on two websites is independent', async (t) => {
    const pipeline = setupMockCommercePipeline(t, { websiteId: WEBSITE_ID });
    const OTHER_WEBSITE = 'bbbbccccddddeeee';
    const { websiteRepository } = await import('../src/repositories/website.repository.js');
    const { makeFakeWebsite } = await import('./helpers/fakeWebsite.js');
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      [WEBSITE_ID, OTHER_WEBSITE].includes(id) ? makeFakeWebsite({ websiteId: id, status: 'active' }) : null
    );
    const { orderRepository } = await import('../src/repositories/order.repository.js');

    await post(pipeline, purchaseEvent({ orderId: 'shared-order-id' }));
    await post(pipeline, { ...purchaseEvent({ orderId: 'shared-order-id' }), websiteId: OTHER_WEBSITE });

    const a = await orderRepository.findByWebsiteAndExternalOrderId(WEBSITE_ID, 'shared-order-id');
    const b = await orderRepository.findByWebsiteAndExternalOrderId(OTHER_WEBSITE, 'shared-order-id');
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a._id, b._id);
  });
});

describe('Order status / validation', () => {
  test('paymentStatus defaults to "pending" when not supplied', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders } = pipeline;
    await post(pipeline, purchaseEvent());
    assert.equal(orders.get(`${WEBSITE_ID}:order-1`).paymentStatus, 'pending');
  });

  test('an explicit valid paymentStatus is honored', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders } = pipeline;
    await post(pipeline, purchaseEvent({ paymentStatus: 'paid' }));
    assert.equal(orders.get(`${WEBSITE_ID}:order-1`).paymentStatus, 'paid');
  });

  test('an invalid paymentStatus is rejected', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { res, body } = await post(pipeline, purchaseEvent({ paymentStatus: 'not-a-real-status' }));
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_DATA');
  });

  test('a negative revenue is rejected', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { res } = await post(pipeline, purchaseEvent({ revenue: -100 }));
    assert.equal(res.status, 400);
  });

  test('refundedAmount defaults to zero on a new order', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders } = pipeline;
    await post(pipeline, purchaseEvent());
    assert.equal(orders.get(`${WEBSITE_ID}:order-1`).refundedAmount, 0);
  });

  test('a fully-specified but inconsistent total is rejected (subtotal - discount + shipping + tax != total)', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { res, body } = await post(pipeline, purchaseEvent({ subtotal: 1000, discount: 200, shipping: 100, tax: 50, total: 500 }));
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_DATA');
  });

  test('a consistent full breakdown is accepted and total is used as sent', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders } = pipeline;
    // 1000 - 200 + 100 + 50 = 950
    const { res } = await post(pipeline, purchaseEvent({ subtotal: 1000, discount: 200, shipping: 100, tax: 50, total: 950 }));
    assert.equal(res.status, 202);
    assert.equal(orders.get(`${WEBSITE_ID}:order-1`).total, 95000);
  });

  test('a partial breakdown (not all five fields) is accepted without forced reconciliation', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { res } = await post(pipeline, purchaseEvent({ discount: 50 })); // only discount, no subtotal/shipping/tax/total
    assert.equal(res.status, 202);
  });
});
