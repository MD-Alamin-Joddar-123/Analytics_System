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

const checkoutEvent = (overrides = {}) => ({
  websiteId: WEBSITE_ID,
  event: 'checkout',
  anonymousId: 'anon-1',
  sessionId: 'sess-1',
  data: {
    checkoutId: 'chk-1',
    cartId: 'cart-1',
    items: [{ productId: 'p1', price: 10, quantity: 1 }],
    cartValue: 10,
    currency: 'USD',
    ...overrides,
  },
});

describe('Checkout', () => {
  test('a checkout event creates a Checkout with status "started"', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { checkouts } = pipeline;

    const { res } = await post(pipeline, checkoutEvent());

    assert.equal(res.status, 202);
    assert.equal(checkouts.size, 1);
    const checkout = checkouts.get(`${WEBSITE_ID}:chk-1`);
    assert.equal(checkout.status, 'started');
    assert.equal(checkout.total, 1000);
  });

  test('the checkout is linked to its cartId', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { checkouts } = pipeline;

    await post(pipeline, checkoutEvent({ cartId: 'my-cart' }));

    assert.equal(checkouts.get(`${WEBSITE_ID}:chk-1`).cartId, 'my-cart');
  });

  test('the checkout is linked to the resolved visitor and session', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { checkouts, visitors, sessions } = pipeline;

    await post(pipeline, checkoutEvent());

    const checkout = checkouts.get(`${WEBSITE_ID}:chk-1`);
    const visitor = visitors.get(`${WEBSITE_ID}:anon-1`);
    const session = sessions.get(`${WEBSITE_ID}:sess-1`);
    assert.equal(String(checkout.visitorId), String(visitor._id));
    assert.equal(checkout.sessionId, session.sessionId);
  });

  test('a purchase referencing the same checkoutId transitions it to "completed"', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { checkouts } = pipeline;

    await post(pipeline, checkoutEvent());
    assert.equal(checkouts.get(`${WEBSITE_ID}:chk-1`).status, 'started');

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'purchase',
      data: {
        orderId: 'order-1',
        checkoutId: 'chk-1',
        revenue: 10,
        currency: 'USD',
        items: [{ productId: 'p1', price: 10, quantity: 1 }],
      },
    });

    const checkout = checkouts.get(`${WEBSITE_ID}:chk-1`);
    assert.equal(checkout.status, 'completed');
    assert.ok(checkout.completedAt);
  });

  test('a purchase does NOT mark an unrelated/missing checkout completed (§25)', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { checkouts } = pipeline;

    await post(pipeline, checkoutEvent());

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'purchase',
      data: {
        orderId: 'order-1',
        checkoutId: 'unrelated-checkout-id',
        revenue: 10,
        currency: 'USD',
        items: [{ productId: 'p1', price: 10, quantity: 1 }],
      },
    });

    assert.equal(checkouts.get(`${WEBSITE_ID}:chk-1`).status, 'started');
    assert.equal(checkouts.has(`${WEBSITE_ID}:unrelated-checkout-id`), false);
  });

  test('a purchase with no checkoutId at all does not touch any checkout', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { checkouts } = pipeline;

    await post(pipeline, checkoutEvent());

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'purchase',
      data: {
        orderId: 'order-1',
        revenue: 10,
        currency: 'USD',
        items: [{ productId: 'p1', price: 10, quantity: 1 }],
      },
    });

    assert.equal(checkouts.get(`${WEBSITE_ID}:chk-1`).status, 'started');
  });

  test('an invalid checkout event (bad currency) is rejected before any commerce work happens', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { checkouts } = pipeline;

    const { res, body } = await post(pipeline, checkoutEvent({ currency: 'ZZZ' }));

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_DATA');
    assert.equal(checkouts.size, 0);
  });

  test('a checkout event without a checkoutId leaves no Checkout behind (graceful degradation)', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { checkouts } = pipeline;

    const { res } = await post(
      pipeline,
      checkoutEvent({ checkoutId: undefined, cartId: undefined, items: [{ productId: 'p1', price: 10, quantity: 1 }] })
    );

    assert.equal(res.status, 202);
    assert.equal(checkouts.size, 0);
  });
});
