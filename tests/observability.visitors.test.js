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

describe('GET /api/reports/:websiteId/visitors', () => {
  test('lists visitors with the documented public fields, no Mongo _id/ownerId leakage', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, pageView(), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/visitors`, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.items.length, 1);
    const visitor = body.data.items[0];
    assert.equal(visitor.visitorId, 'anon-1');
    assert.equal(typeof visitor.firstSeenAt, 'string');
    assert.equal(typeof visitor.lastSeenAt, 'string');
    assert.equal(visitor.sessionCount, 1);
    assert.equal(visitor.eventCount, 1);
    assert.equal(visitor.firstUrl, 'https://store.com/');
    assert.equal(visitor.lastUrl, 'https://store.com/');
    assert.ok(visitor.device);
    for (const forbidden of ['_id', 'id', 'ownerId', 'password', 'passwordHash']) {
      assert.equal(Object.prototype.hasOwnProperty.call(visitor, forbidden), false, forbidden);
    }
  });

  test('paginates and reports page/limit/total/totalPages', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await postAndProcess(baseUrl, pageView({ anonymousId: `anon-${i}`, sessionId: `sess-${i}` }), pipeline);
    }

    const res = await get(`/api/reports/${pipeline.websiteId}/visitors?page=2&limit=2`, pipeline.token);
    const body = await res.json();

    assert.equal(body.data.items.length, 1);
    assert.deepEqual(body.data.pagination, { page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  test('sorts by lastSeenAt (default) descending', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, pageView({ anonymousId: 'older', sessionId: 's-older' }), pipeline);
    const olderVisitor = pipeline.visitors.get(`${WEBSITE_ID}:older`);
    olderVisitor.lastSeenAt = new Date('2020-01-01T00:00:00.000Z');
    await postAndProcess(baseUrl, pageView({ anonymousId: 'newer', sessionId: 's-newer' }), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/visitors`, pipeline.token);
    const body = await res.json();
    assert.deepEqual(body.data.items.map((v) => v.visitorId), ['newer', 'older']);
  });

  test('rejects an unrecognized sort field', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/visitors?sort=__proto__`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_SORT');
  });

  test('rejects a limit above the safe maximum', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/visitors?limit=100000`, pipeline.token);
    assert.equal(res.status, 400);
  });

  test('requires authentication', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/visitors`);
    assert.equal(res.status, 401);
  });

  test('website isolation: a visitor under website B never appears in website A\'s list', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    pipeline.seedWebsite('bbbbbbbbbbbbbbbb', {});
    await postAndProcess(baseUrl, pageView(), pipeline);
    await postAndProcess(baseUrl, { ...pageView({ anonymousId: 'other-site-visitor' }), websiteId: 'bbbbbbbbbbbbbbbb' }, pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/visitors`, pipeline.token);
    const body = await res.json();
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].visitorId, 'anon-1');
  });
});

describe('GET /api/reports/:websiteId/visitors/:visitorId', () => {
  test('returns visitor detail with session history and recent events', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, pageView(), pipeline);
    await postAndProcess(baseUrl, pageView({ path: '/about', url: 'https://store.com/about' }), pipeline);

    const res = await get(`/api/reports/${pipeline.websiteId}/visitors/anon-1`, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.visitorId, 'anon-1');
    assert.equal(body.data.eventCount, 2);
    assert.equal(body.data.sessions.length, 1);
    assert.equal(body.data.sessions[0].sessionId, 'sess-1');
    assert.equal(body.data.recentEvents.length, 2);
    assert.equal(body.data.recentEvents[0].eventName, 'page_view');
    assert.ok('eventId' in body.data.recentEvents[0]);
  });

  test('a nonexistent visitor returns 404 VISITOR_NOT_FOUND', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/visitors/does-not-exist`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'VISITOR_NOT_FOUND');
  });

  test('an oversized visitorId is rejected before any lookup', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/visitors/${'x'.repeat(200)}`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_VISITOR_ID');
  });

  test('the same anonymousId under a different website is a separate, isolated visitor', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    pipeline.seedWebsite('bbbbbbbbbbbbbbbb', {});
    await postAndProcess(baseUrl, pageView(), pipeline);

    const res = await get('/api/reports/bbbbbbbbbbbbbbbb/visitors/anon-1', pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'VISITOR_NOT_FOUND');
  });

  test('a different authenticated user cannot see another user\'s visitor data', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t, { ownerId: 'owner-A' });
    await postAndProcess(baseUrl, pageView(), pipeline);

    const { userRepository } = await import('../src/repositories/user.repository.js');
    const { signAuthToken } = await import('../src/utils/jwt.js');
    t.mock.method(userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });

    const res = await get(`/api/reports/${pipeline.websiteId}/visitors/anon-1`, attackerToken);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'WEBSITE_NOT_FOUND');
  });
});
