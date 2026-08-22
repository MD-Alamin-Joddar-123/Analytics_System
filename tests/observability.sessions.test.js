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

function pageView(overrides = {}) {
  return {
    websiteId: WEBSITE_ID,
    event: 'page_view',
    anonymousId: 'anon-1',
    sessionId: 'sess-1',
    url: 'https://store.com/',
    path: '/',
    ...overrides,
  };
}

function productView(overrides = {}) {
  return {
    websiteId: WEBSITE_ID,
    event: 'product_view',
    anonymousId: 'anon-1',
    sessionId: 'sess-1',
    data: { productId: 'p1', name: 'Widget', price: 20, currency: 'USD' },
    ...overrides,
  };
}

describe('GET /api/reports/:websiteId/sessions', () => {
  test('lists sessions with the documented public fields', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, pageView(), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/sessions`, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.items.length, 1);
    const session = body.data.items[0];
    assert.equal(session.sessionId, 'sess-1');
    assert.equal(session.visitorId, 'anon-1');
    assert.equal(typeof session.startedAt, 'string');
    assert.equal(typeof session.lastActivityAt, 'string');
    assert.equal(session.landingPage, 'https://store.com/');
    assert.equal(session.pageViewCount, 1);
    assert.equal(session.eventCount, 1);
    for (const forbidden of ['_id', 'id']) {
      assert.equal(Object.prototype.hasOwnProperty.call(session, forbidden), false);
    }
  });

  test('paginates and sorts', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await postAndProcess(baseUrl, pageView({ anonymousId: `anon-${i}`, sessionId: `sess-${i}` }), pipeline);
    }
    const res = await get(`/api/reports/${pipeline.websiteId}/sessions?page=1&limit=2&sort=eventCount&order=asc`, pipeline.token);
    const body = await res.json();
    assert.equal(body.data.items.length, 2);
    assert.deepEqual(body.data.pagination, { page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  test('rejects an invalid sort/order', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/sessions?order=sideways`, pipeline.token);
    assert.equal(res.status, 400);
  });

  test('requires authentication', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/sessions`);
    assert.equal(res.status, 401);
  });
});

describe('GET /api/reports/:websiteId/sessions/:sessionId', () => {
  test('returns a chronological event timeline with allow-listed data fields only', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, pageView(), pipeline);
    await postAndProcess(baseUrl, productView(), pipeline);
    await postAndProcess(
      baseUrl,
      {
        websiteId: WEBSITE_ID,
        event: 'add_to_cart',
        anonymousId: 'anon-1',
        sessionId: 'sess-1',
        data: { productId: 'p1', name: 'Widget', price: 20, quantity: 2, currency: 'USD' },
      },
      pipeline
    );

    const res = await get(`/api/reports/${pipeline.websiteId}/sessions/sess-1`, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.sessionId, 'sess-1');
    assert.equal(body.data.timeline.length, 3);
    assert.deepEqual(
      body.data.timeline.map((e) => e.eventName),
      ['page_view', 'product_view', 'add_to_cart']
    );
    // chronological (ascending timestamp)
    const timestamps = body.data.timeline.map((e) => new Date(e.timestamp).getTime());
    assert.ok(timestamps[0] <= timestamps[1] && timestamps[1] <= timestamps[2]);

    const addToCart = body.data.timeline[2];
    assert.equal(addToCart.data.productId, 'p1');
    assert.equal(addToCart.data.quantity, 2);
    assert.equal(addToCart.data.price, 20);
    // never arbitrary/unlisted fields
    for (const forbidden of ['password', 'passwordHash', 'cardNumber', 'cvv', 'token', 'authorization']) {
      assert.equal(Object.prototype.hasOwnProperty.call(addToCart.data, forbidden), false);
    }
  });

  test('a nonexistent session returns 404 SESSION_NOT_FOUND', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/sessions/does-not-exist`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'SESSION_NOT_FOUND');
  });

  test('an oversized sessionId is rejected before any lookup', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/sessions/${'x'.repeat(200)}`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_SESSION_ID');
  });

  test('the same sessionId under a different website is isolated', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    pipeline.seedWebsite('bbbbbbbbbbbbbbbb', {});
    await postAndProcess(baseUrl, pageView(), pipeline);

    const res = await get('/api/reports/bbbbbbbbbbbbbbbb/sessions/sess-1', pipeline.token);
    assert.equal(res.status, 404);
  });
});
