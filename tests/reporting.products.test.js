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

function seedThreeProducts(pipeline) {
  pipeline.seedProductBucket({
    productId: 'p1',
    productNameSnapshot: 'Widget',
    bucket: new Date('2026-08-10T00:00:00.000Z'),
    productViews: 100,
    addToCarts: 10,
    unitsSold: 5,
    orders: 5,
    revenueMinor: 50000,
  });
  pipeline.seedProductBucket({
    productId: 'p2',
    productNameSnapshot: 'Gadget',
    bucket: new Date('2026-08-10T00:00:00.000Z'),
    productViews: 300,
    addToCarts: 30,
    unitsSold: 20,
    orders: 15,
    revenueMinor: 200000,
  });
  pipeline.seedProductBucket({
    productId: 'p3',
    productNameSnapshot: 'Gizmo',
    bucket: new Date('2026-08-11T00:00:00.000Z'),
    productViews: 50,
    addToCarts: 5,
    unitsSold: 1,
    orders: 1,
    revenueMinor: 10000,
  });
}

describe('GET /api/reports/:websiteId/products', () => {
  test('returns top products sorted by revenue (default), external productId, no Mongo _id leakage', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    seedThreeProducts(pipeline);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/products?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(
      body.data.items.map((i) => i.productId),
      ['p2', 'p1', 'p3']
    );
    assert.equal(body.data.items[0].productName, 'Gadget');
    assert.equal(body.data.items[0].revenue, 2000);
    for (const item of body.data.items) {
      assert.equal(Object.prototype.hasOwnProperty.call(item, '_id'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(item, 'id'), false);
    }
  });

  test('supports sorting by views, ascending', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    seedThreeProducts(pipeline);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/products?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&sort=views&order=asc`,
      pipeline.token
    );
    const body = await res.json();

    assert.deepEqual(
      body.data.items.map((i) => i.productId),
      ['p3', 'p1', 'p2']
    );
  });

  test('supports sorting by orders and addToCart and purchaseQuantity', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    seedThreeProducts(pipeline);

    for (const [sortKey, expectedTopId] of [
      ['orders', 'p2'],
      ['addToCart', 'p2'],
      ['purchaseQuantity', 'p2'],
    ]) {
      const res = await get(
        `/api/reports/${pipeline.websiteId}/products?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&sort=${sortKey}`,
        pipeline.token
      );
      const body = await res.json();
      assert.equal(body.data.items[0].productId, expectedTopId, `sort=${sortKey}`);
    }
  });

  test('rejects an unrecognized sort field rather than passing it through to Mongo (§12)', async (t) => {
    const pipeline = setupMockReportingPipeline(t);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/products?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&sort=__proto__`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_SORT');
  });

  test('paginates results and reports correct page/limit/total/totalPages', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    seedThreeProducts(pipeline);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/products?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&page=2&limit=2`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(body.data.items.length, 1);
    assert.deepEqual(body.data.pagination, { page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  test('rejects a limit above the safe maximum, never allowing an unbounded result set (§11)', async (t) => {
    const pipeline = setupMockReportingPipeline(t);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/products?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&limit=100000`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_PAGINATION');
  });

  test('rejects a non-positive or non-integer page', async (t) => {
    const pipeline = setupMockReportingPipeline(t);

    for (const page of ['0', '-1', '1.5', 'abc']) {
      const res = await get(
        `/api/reports/${pipeline.websiteId}/products?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&page=${page}`,
        pipeline.token
      );
      assert.equal(res.status, 400, `page=${page}`);
    }
  });

  test('multi-tenant isolation: the same productId under two websites is never mixed', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { websiteId: 'aaaaaaaaaaaaaaaa' });
    pipeline.seedWebsite('bbbbbbbbbbbbbbbb', {});
    pipeline.seedProductBucket({ websiteId: 'aaaaaaaaaaaaaaaa', productId: 'shared-sku', productNameSnapshot: 'A-name', bucket: new Date('2026-08-10T00:00:00.000Z'), productViews: 10, revenueMinor: 1000 });
    pipeline.seedProductBucket({ websiteId: 'bbbbbbbbbbbbbbbb', productId: 'shared-sku', productNameSnapshot: 'B-name', bucket: new Date('2026-08-10T00:00:00.000Z'), productViews: 999, revenueMinor: 99900 });

    const resA = await get('/api/reports/aaaaaaaaaaaaaaaa/products?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z', pipeline.token);
    const bodyA = await resA.json();
    assert.equal(bodyA.data.items.length, 1);
    assert.equal(bodyA.data.items[0].productName, 'A-name');
    assert.equal(bodyA.data.items[0].views, 10);
  });
});

describe('GET /api/reports/:websiteId/products/:productId', () => {
  test('returns a detailed report for one product, scoped by websiteId', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedProductBucket({
      productId: 'p1',
      productNameSnapshot: 'Widget',
      bucket: new Date('2026-08-10T00:00:00.000Z'),
      productViews: 100,
      addToCarts: 20,
      removeFromCarts: 3,
      unitsSold: 8,
      orders: 6,
      revenueMinor: 80000,
    });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/products/p1?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.productId, 'p1');
    assert.equal(body.data.productName, 'Widget');
    assert.equal(body.data.views, 100);
    assert.equal(body.data.addToCart, 20);
    assert.equal(body.data.removeFromCart, 3);
    assert.equal(body.data.purchaseQuantity, 8);
    assert.equal(body.data.orders, 6);
    assert.equal(body.data.revenue, 800);
    assert.equal(body.data.checkoutQuantity, null);
    assert.equal(typeof body.data.conversionRates.viewToCartRate, 'number');
    assert.equal(Number.isFinite(body.data.conversionRates.viewToCartRate), true);
  });

  test('a product with zero analytics activity but a known catalog entry returns a zeroed report, not 404', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedProduct(pipeline.websiteId, 'p-known', { name: 'Known But Quiet' });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/products/p-known?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.productName, 'Known But Quiet');
    assert.equal(body.data.views, 0);
    assert.equal(body.data.revenue, 0);
  });

  test('a completely unknown productId (no activity, no catalog entry) returns 404 PRODUCT_NOT_FOUND', async (t) => {
    const pipeline = setupMockReportingPipeline(t);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/products/does-not-exist?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'PRODUCT_NOT_FOUND');
  });

  test('the same productId under a different website returns that website\'s own (isolated) report', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { websiteId: 'aaaaaaaaaaaaaaaa' });
    pipeline.seedWebsite('bbbbbbbbbbbbbbbb', {});
    pipeline.seedProductBucket({ websiteId: 'aaaaaaaaaaaaaaaa', productId: 'shared', productNameSnapshot: 'A', bucket: new Date('2026-08-10T00:00:00.000Z'), productViews: 5 });
    pipeline.seedProductBucket({ websiteId: 'bbbbbbbbbbbbbbbb', productId: 'shared', productNameSnapshot: 'B', bucket: new Date('2026-08-10T00:00:00.000Z'), productViews: 500 });

    const res = await get('/api/reports/aaaaaaaaaaaaaaaa/products/shared?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z', pipeline.token);
    const body = await res.json();
    assert.equal(body.data.views, 5);
    assert.equal(body.data.productName, 'A');
  });
});
