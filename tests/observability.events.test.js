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
    anonymousId: 'anon-2',
    sessionId: 'sess-2',
    data: { productId: 'p1', name: 'Widget', price: 20, currency: 'USD' },
    ...overrides,
  };
}

describe('GET /api/reports/:websiteId/events', () => {
  test('lists events with the documented public fields', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, pageView(), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/events`, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.items.length, 1);
    const event = body.data.items[0];
    assert.match(event.eventId, /^[0-9a-f-]{36}$/);
    assert.equal(event.eventName, 'page_view');
    assert.equal(typeof event.timestamp, 'string');
    assert.equal(event.visitorId, 'anon-1');
    assert.equal(event.sessionId, 'sess-1');
    assert.equal(event.url, 'https://store.com/');
    assert.equal(event.processingStatus, 'completed');
    for (const forbidden of ['_id', 'id', 'data']) {
      assert.equal(Object.prototype.hasOwnProperty.call(event, forbidden), false);
    }
  });

  test('filters by eventName', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, pageView(), pipeline);
    await postAndProcess(baseUrl, productView(), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/events?eventName=product_view`, pipeline.token);
    const body = await res.json();
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].eventName, 'product_view');
  });

  test('rejects an unsupported eventName filter', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/events?eventName=totally_fake`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_TYPE_FILTER');
  });

  test('filters by visitorId and sessionId', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, pageView(), pipeline);
    await postAndProcess(baseUrl, productView(), pipeline);

    const byVisitor = await get(`/api/reports/${pipeline.websiteId}/events?visitorId=anon-2`, pipeline.token);
    const byVisitorBody = await byVisitor.json();
    assert.equal(byVisitorBody.data.items.length, 1);
    assert.equal(byVisitorBody.data.items[0].visitorId, 'anon-2');

    const bySession = await get(`/api/reports/${pipeline.websiteId}/events?sessionId=sess-1`, pipeline.token);
    const bySessionBody = await bySession.json();
    assert.equal(bySessionBody.data.items.length, 1);
    assert.equal(bySessionBody.data.items[0].sessionId, 'sess-1');
  });

  test('rejects a NoSQL-injection-shaped visitorId/sessionId filter (object, not a string)', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/events?visitorId[$ne]=`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_VISITOR_ID');
  });

  test('filters by date range', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, pageView(), pipeline);
    const event = [...pipeline.events.values()][0];
    event.timestamp = new Date('2020-01-01T00:00:00.000Z');

    const res = await get(
      `/api/reports/${pipeline.websiteId}/events?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();
    assert.equal(body.data.items.length, 0);
  });

  test('rejects a malformed date filter', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/events?from=not-a-date`, pipeline.token);
    assert.equal(res.status, 400);
  });

  test('rejects from after to', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(
      `/api/reports/${pipeline.websiteId}/events?from=2026-12-31T00:00:00.000Z&to=2026-01-01T00:00:00.000Z`,
      pipeline.token
    );
    assert.equal(res.status, 400);
  });

  test('rejects an excessively large date range', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(
      `/api/reports/${pipeline.websiteId}/events?from=2000-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_DATE_RANGE');
  });

  test('paginates', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await postAndProcess(baseUrl, pageView({ path: `/p${i}` }), pipeline);
    }
    const res = await get(`/api/reports/${pipeline.websiteId}/events?page=2&limit=2`, pipeline.token);
    const body = await res.json();
    assert.equal(body.data.items.length, 1);
    assert.deepEqual(body.data.pagination, { page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  test('requires authentication', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/events`);
    assert.equal(res.status, 401);
  });
});

describe('GET /api/reports/:websiteId/events/:eventId', () => {
  test('returns full event detail with allow-listed data only', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, productView(), pipeline);
    const eventId = [...pipeline.events.values()][0].eventId;

    const res = await get(`/api/reports/${pipeline.websiteId}/events/${eventId}`, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.eventId, eventId);
    assert.equal(body.data.eventName, 'product_view');
    assert.equal(body.data.visitorId, 'anon-2');
    assert.equal(body.data.sessionId, 'sess-2');
    assert.equal(body.data.data.productId, 'p1');
    assert.equal(body.data.data.price, 20);
    assert.ok(body.data.device);
    for (const forbidden of ['_id', 'id']) {
      assert.equal(Object.prototype.hasOwnProperty.call(body.data, forbidden), false);
    }
  });

  test('a nonexistent eventId returns 404 EVENT_NOT_FOUND', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/events/00000000-0000-0000-0000-000000000000`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'EVENT_NOT_FOUND');
  });

  test('an invalid eventId shape is rejected before any lookup', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/events/${encodeURIComponent('not valid!')}`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_ID');
  });
});
