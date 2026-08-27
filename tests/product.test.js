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

describe('Product upsert', () => {
  test('a product_view creates a Product, priced in integer minor units', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { products } = pipeline;

    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'product_view',
      data: { productId: 'p123', name: 'Laptop', price: 850.5, currency: 'BDT' },
    });

    assert.equal(products.size, 1);
    const product = products.get(`${WEBSITE_A}:p123`);
    assert.equal(product.name, 'Laptop');
    assert.equal(product.price, 85050);
    assert.equal(Number.isInteger(product.price), true);
    assert.equal(product.currency, 'BDT');
  });

  test('an existing product is reused, not duplicated, and metadata refreshes', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { products } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'product_view', data: { productId: 'p1', name: 'Old Name', price: 100 } });
    await post(pipeline, { websiteId: WEBSITE_A, event: 'product_view', data: { productId: 'p1', name: 'New Name', price: 120 } });

    assert.equal(products.size, 1);
    const product = products.get(`${WEBSITE_A}:p1`);
    assert.equal(product.name, 'New Name');
    assert.equal(product.price, 12000);
  });

  test('the same externalProductId on two different websites produces two isolated products', async (t) => {
    const pipeline = setupMockCommercePipeline(t, { websiteId: WEBSITE_A });
    const { websiteRepository } = await import('../src/repositories/website.repository.js');
    const { makeFakeWebsite } = await import('./helpers/fakeWebsite.js');
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      [WEBSITE_A, WEBSITE_B].includes(id) ? makeFakeWebsite({ websiteId: id, status: 'active' }) : null
    );
    const { productRepository } = await import('../src/repositories/product.repository.js');

    await post(pipeline, { websiteId: WEBSITE_A, event: 'product_view', data: { productId: 'shared-id', name: 'A copy' } });
    await post(pipeline, { websiteId: WEBSITE_B, event: 'product_view', data: { productId: 'shared-id', name: 'B copy' } });

    const a = await productRepository.findByWebsiteAndExternalId(WEBSITE_A, 'shared-id');
    const b = await productRepository.findByWebsiteAndExternalId(WEBSITE_B, 'shared-id');
    assert.equal(a.name, 'A copy');
    assert.equal(b.name, 'B copy');
    assert.notEqual(a._id, b._id);
  });

  test('firstSeenAt is preserved across later sightings; lastSeenAt updates', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { products } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'product_view', data: { productId: 'p1' } });
    const firstSeenAt = products.get(`${WEBSITE_A}:p1`).firstSeenAt;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'product_view', data: { productId: 'p1' } });
    const product = products.get(`${WEBSITE_A}:p1`);

    assert.equal(product.firstSeenAt, firstSeenAt);
    assert.ok(product.lastSeenAt >= firstSeenAt);
  });

  test('add_to_cart also resolves/creates the product (not just product_view)', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { products } = pipeline;

    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'add_to_cart',
      data: { cartId: 'cart-1', productId: 'p-from-cart', name: 'Shoes', price: 45, quantity: 1, currency: 'USD' },
    });

    assert.equal(products.size, 1);
    assert.ok(products.has(`${WEBSITE_A}:p-from-cart`));
  });

  test('concurrent processing of two first sightings of the same new product do not create duplicates', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { products, events } = pipeline;

    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId: WEBSITE_A, event: 'product_view', data: { productId: 'race-product', name: 'A' } }),
      }),
      fetch(`${baseUrl}/api/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId: WEBSITE_A, event: 'product_view', data: { productId: 'race-product', name: 'B' } }),
      }),
    ]);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);

    const docA = events.get(`${WEBSITE_A}:${bodyA.data.eventId}`);
    const docB = events.get(`${WEBSITE_A}:${bodyB.data.eventId}`);
    await Promise.all([
      eventProcessingService.processEvent(docA._id),
      eventProcessingService.processEvent(docB._id),
    ]);

    assert.equal(products.size, 1);
  });
});
