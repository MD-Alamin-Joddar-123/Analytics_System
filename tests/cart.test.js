import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockCommercePipeline } from './helpers/mockCommercePipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';
import { eventProcessingService } from '../src/services/event/eventProcessing.service.js';

const WEBSITE_A = 'a1b2c3d4e5f60718';
const WEBSITE_B = 'bbbbccccddddeeee';

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

const addToCart = (overrides = {}) => ({
  websiteId: WEBSITE_A,
  event: 'add_to_cart',
  data: { cartId: 'cart-1', productId: 'p1', price: 10, quantity: 1, currency: 'USD', ...overrides },
});

describe('Cart / CartItem — add_to_cart', () => {
  test('the first add_to_cart creates a Cart and a CartItem', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { carts, cartItems } = pipeline;

    await post(pipeline, addToCart());

    assert.equal(carts.size, 1);
    const cart = carts.get(`${WEBSITE_A}:cart-1`);
    assert.equal(cart.itemCount, 1);
    assert.equal(cart.subtotal, 1000);

    assert.equal(cartItems.size, 1);
    const item = cartItems.get(`${WEBSITE_A}:cart-1:p1`);
    assert.equal(item.quantity, 1);
    assert.equal(item.unitPrice, 1000);
  });

  test('an existing cart is reused for a second add_to_cart in the same cart', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { carts } = pipeline;

    await post(pipeline, addToCart({ productId: 'p1' }));
    await post(pipeline, addToCart({ productId: 'p2' }));

    assert.equal(carts.size, 1);
  });

  test('adding the same product twice increments quantity on the existing CartItem, not a duplicate', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { cartItems } = pipeline;

    await post(pipeline, addToCart({ productId: 'p1', quantity: 2 }));
    await post(pipeline, addToCart({ productId: 'p1', quantity: 3 }));

    assert.equal(cartItems.size, 1);
    assert.equal(cartItems.get(`${WEBSITE_A}:cart-1:p1`).quantity, 5);
  });

  test('Cart.itemCount and subtotal accumulate correctly across multiple adds', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { carts } = pipeline;

    await post(pipeline, addToCart({ productId: 'p1', price: 10, quantity: 2 }));
    await post(pipeline, addToCart({ productId: 'p2', price: 5, quantity: 1 }));

    const cart = carts.get(`${WEBSITE_A}:cart-1`);
    assert.equal(cart.itemCount, 3);
    assert.equal(cart.subtotal, 2500);
  });

  test('cross-website cart isolation: the same cartId on two websites is independent', async (t) => {
    const pipeline = setupMockCommercePipeline(t, { websiteId: WEBSITE_A });
    const { carts } = pipeline;
    const { websiteRepository } = await import('../src/repositories/website.repository.js');
    const { makeFakeWebsite } = await import('./helpers/fakeWebsite.js');
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      [WEBSITE_A, WEBSITE_B].includes(id) ? makeFakeWebsite({ websiteId: id, status: 'active' }) : null
    );

    await post(pipeline, addToCart());
    await post(pipeline, { ...addToCart(), websiteId: WEBSITE_B });

    assert.equal(carts.size, 2);
    assert.notEqual(carts.get(`${WEBSITE_A}:cart-1`)._id, carts.get(`${WEBSITE_B}:cart-1`)._id);
  });

  test('add_to_cart without a cartId leaves no Cart/CartItem behind (graceful degradation)', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { carts, cartItems } = pipeline;

    const { res } = await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'add_to_cart',
      data: { productId: 'p1', price: 10, quantity: 1 },
    });

    assert.equal(res.status, 202);
    assert.equal(carts.size, 0);
    assert.equal(cartItems.size, 0);
  });

  test('concurrent processing of two add_to_cart events for the same new product in the same cart does not duplicate the CartItem', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { cartItems, events } = pipeline;

    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addToCart({ productId: 'race-p', quantity: 1 })),
      }),
      fetch(`${baseUrl}/api/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addToCart({ productId: 'race-p', quantity: 1 })),
      }),
    ]);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);

    const docA = events.get(`${WEBSITE_A}:${bodyA.data.eventId}`);
    const docB = events.get(`${WEBSITE_A}:${bodyB.data.eventId}`);
    await Promise.all([
      eventProcessingService.processEvent(docA._id),
      eventProcessingService.processEvent(docB._id),
    ]);

    assert.equal(cartItems.size, 1);
    assert.equal(cartItems.get(`${WEBSITE_A}:cart-1:race-p`).quantity, 2);
  });
});

describe('Cart / CartItem — remove_from_cart', () => {
  test('removing part of the quantity decrements without deleting the item', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { cartItems, carts } = pipeline;

    await post(pipeline, addToCart({ productId: 'p1', price: 10, quantity: 5 }));
    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'remove_from_cart',
      data: { cartId: 'cart-1', productId: 'p1', quantity: 2 },
    });

    const item = cartItems.get(`${WEBSITE_A}:cart-1:p1`);
    assert.equal(item.quantity, 3);
    const cart = carts.get(`${WEBSITE_A}:cart-1`);
    assert.equal(cart.itemCount, 3);
    assert.equal(cart.subtotal, 3000);
  });

  test('removing the full remaining quantity deletes the CartItem', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { cartItems } = pipeline;

    await post(pipeline, addToCart({ productId: 'p1', price: 10, quantity: 2 }));
    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'remove_from_cart',
      data: { cartId: 'cart-1', productId: 'p1', quantity: 2 },
    });

    assert.equal(cartItems.has(`${WEBSITE_A}:cart-1:p1`), false);
  });

  test('never allows negative quantity: removing more than present clamps at zero and deletes', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { cartItems, carts } = pipeline;

    await post(pipeline, addToCart({ productId: 'p1', price: 10, quantity: 2 }));
    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'remove_from_cart',
      data: { cartId: 'cart-1', productId: 'p1', quantity: 100 },
    });

    assert.equal(cartItems.has(`${WEBSITE_A}:cart-1:p1`), false);
    const cart = carts.get(`${WEBSITE_A}:cart-1`);
    assert.equal(cart.itemCount, 0);
    assert.ok(cart.itemCount >= 0);
    assert.ok(cart.subtotal >= 0);
  });

  test('remove_from_cart does not require price (Phase 6 contract)', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    await post(pipeline, addToCart({ productId: 'p1', price: 10, quantity: 1 }));

    const { res } = await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'remove_from_cart',
      data: { cartId: 'cart-1', productId: 'p1', quantity: 1 },
    });

    assert.equal(res.status, 202);
  });

  test('removing from a nonexistent cart or product is a safe no-op', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { carts } = pipeline;

    const { res } = await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'remove_from_cart',
      data: { cartId: 'never-existed', productId: 'p1', quantity: 1 },
    });

    assert.equal(res.status, 202);
    assert.equal(carts.size, 0);
  });
});
