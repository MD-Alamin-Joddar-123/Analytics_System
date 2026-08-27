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

function dayBucketFor(pipeline, isoDate) {
  return pipeline.analytics.buckets.get(`${WEBSITE_ID}:day:${isoDate}`);
}

describe('Analytics end-to-end — full funnel through the real HTTP + worker pipeline', () => {
  test('page_view -> product_view -> add_to_cart -> checkout -> purchase aggregates correctly into one day bucket', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const nowIso = new Date().toISOString();
    const dayIso = nowIso.slice(0, 10) + 'T00:00:00.000Z';

    await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-1' });

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'product_view',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      data: { productId: 'p1', name: 'Laptop', price: 850, currency: 'USD' },
    });

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'add_to_cart',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      data: { cartId: 'cart-1', productId: 'p1', name: 'Laptop', price: 850, quantity: 1, currency: 'USD' },
    });

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'checkout',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      data: {
        checkoutId: 'chk-1',
        cartId: 'cart-1',
        items: [{ productId: 'p1', name: 'Laptop', price: 850, quantity: 1 }],
        cartValue: 850,
        currency: 'USD',
      },
    });

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'purchase',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      data: {
        orderId: 'order-1',
        checkoutId: 'chk-1',
        revenue: 850,
        currency: 'USD',
        items: [{ productId: 'p1', name: 'Laptop', price: 850, quantity: 1 }],
      },
    });

    const dayBucket = dayBucketFor(pipeline, dayIso);
    assert.ok(dayBucket, 'a day bucket document should exist for this website');

    assert.equal(dayBucket.pageViews, 1);
    assert.equal(dayBucket.uniqueVisitors, 1);
    assert.equal(dayBucket.uniqueSessions, 1);

    assert.equal(dayBucket.productViews, 1);
    assert.equal(dayBucket.addToCarts, 1);
    assert.equal(dayBucket.cartsCreated, 1);
    assert.equal(dayBucket.cartQuantity, 1);
    assert.equal(dayBucket.cartValueMinor, 85000);

    assert.equal(dayBucket.checkoutStarted, 1);
    assert.equal(dayBucket.checkoutCompleted, 1);

    assert.equal(dayBucket.orders, 1);
    assert.equal(dayBucket.unitsSold, 1);
    assert.equal(dayBucket.grossRevenueMinor, 85000);
    assert.equal(dayBucket.netRevenueMinor, 85000);
    assert.equal(dayBucket.currency, 'USD');

    const productDayBucket = pipeline.analytics.productBuckets.get(`${WEBSITE_ID}:p1:day:${dayIso}`);
    assert.equal(productDayBucket.productViews, 1);
    assert.equal(productDayBucket.addToCarts, 1);
    assert.equal(productDayBucket.unitsSold, 1);
    assert.equal(productDayBucket.revenueMinor, 85000);
    assert.equal(productDayBucket.productNameSnapshot, 'Laptop');
  });

  test('a duplicate purchase submission (same eventId) is not double-counted end-to-end', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const dayIso = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';

    const purchase = {
      websiteId: WEBSITE_ID,
      event: 'purchase',
      eventId: 'fixed-event-id-1',
      anonymousId: 'anon-1',
      data: { orderId: 'order-dup', revenue: 100, currency: 'USD', items: [{ productId: 'p1', price: 100, quantity: 1 }] },
    };

    await post(pipeline, purchase);
    await post(pipeline, purchase);

    const dayBucket = dayBucketFor(pipeline, dayIso);
    assert.equal(dayBucket.orders, 1);
    assert.equal(dayBucket.grossRevenueMinor, 10000);
  });

  test('two different websites accumulate completely independent analytics for the same product id', async (t) => {
    const WEBSITE_B = 'bbbbccccddddeeee';
    const pipeline = setupMockCommercePipeline(t, { websiteId: WEBSITE_ID });
    const { websiteRepository } = await import('../src/repositories/website.repository.js');
    const { makeFakeWebsite } = await import('./helpers/fakeWebsite.js');
    const originalFind = websiteRepository.findByWebsiteId;
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) => {
      if (id === WEBSITE_B) return makeFakeWebsite({ websiteId: WEBSITE_B, status: 'active' });
      return originalFind(id);
    });

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'product_view',
      data: { productId: 'shared-sku', name: 'Widget A', price: 10, currency: 'USD' },
    });
    await post(pipeline, {
      websiteId: WEBSITE_B,
      event: 'product_view',
      data: { productId: 'shared-sku', name: 'Widget B', price: 20, currency: 'USD' },
    });

    const dayIso = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const productA = pipeline.analytics.productBuckets.get(`${WEBSITE_ID}:shared-sku:day:${dayIso}`);
    const productB = pipeline.analytics.productBuckets.get(`${WEBSITE_B}:shared-sku:day:${dayIso}`);

    assert.equal(productA.productViews, 1);
    assert.equal(productA.productNameSnapshot, 'Widget A');
    assert.equal(productB.productViews, 1);
    assert.equal(productB.productNameSnapshot, 'Widget B');
  });
});
