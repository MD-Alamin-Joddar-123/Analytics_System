import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockReportingPipeline } from './helpers/mockReportingPipeline.js';
import { eventRepository } from '../src/repositories/event.repository.js';
import { signAuthToken } from '../src/utils/jwt.js';

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

const RANGE = 'from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z';

describe('Reporting API — authentication', () => {
  test('every report endpoint requires a valid JWT', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const endpoints = [
      'overview',
      'timeseries',
      'products',
      'products/p1',
      'conversion',
      'cart-checkout',
      'revenue',
    ];
    for (const endpoint of endpoints) {
      const res = await get(`/api/reports/${pipeline.websiteId}/${endpoint}?${RANGE}`);
      assert.equal(res.status, 401, endpoint);
      const body = await res.json();
      assert.equal(body.error.code, 'AUTH_REQUIRED', endpoint);
    }
  });

  test('an expired/invalid token is rejected', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/overview?${RANGE}`, 'not-a-real-token');
    assert.equal(res.status, 401);
  });
});

describe('Reporting API — website ownership (§9)', () => {
  test('a different authenticated user cannot see another user\'s website analytics (cross-user access)', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { ownerId: 'owner-A' });
    pipeline.seedBucket({ bucket: new Date('2026-08-10T00:00:00.000Z'), pageViews: 12345 });
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });
    t.mock.method((await import('../src/repositories/user.repository.js')).userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });

    const res = await get(`/api/reports/${pipeline.websiteId}/overview?${RANGE}`, attackerToken);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
    assert.equal(JSON.stringify(body).includes('12345'), false);

    const ownerRes = await get(`/api/reports/${pipeline.websiteId}/overview?${RANGE}`, pipeline.token);
    assert.equal(ownerRes.status, 200);
  });

  test('never trusts a client-supplied ownerId — ownership is always resolved from the JWT, never a query/body param', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { ownerId: 'owner-A' });
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });
    t.mock.method((await import('../src/repositories/user.repository.js')).userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });

    const res = await get(`/api/reports/${pipeline.websiteId}/overview?${RANGE}&ownerId=owner-A`, attackerToken);
    assert.equal(res.status, 404);
  });

  test('an invalid websiteId shape is rejected before any ownership/database lookup', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await get(`/api/reports/not-a-valid-website-id/overview?${RANGE}`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_WEBSITE_ID');
  });

  test('a well-formed but non-existent websiteId is a safe 404, not a 500', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await get(`/api/reports/ffffffffffffffff/overview?${RANGE}`, pipeline.token);
    assert.equal(res.status, 404);
  });
});

describe('Reporting API — cross-website analytics isolation (§10, HTTP-level)', () => {
  test('a user who owns Website A cannot read Website B\'s analytics even by guessing its websiteId', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { websiteId: 'aaaaaaaaaaaaaaaa', ownerId: 'owner-A' });
    pipeline.websites.set('bbbbbbbbbbbbbbbb', { websiteId: 'bbbbbbbbbbbbbbbb', ownerId: 'owner-B', currency: 'EUR', status: 'active' });

    const res = await get('/api/reports/bbbbbbbbbbbbbbbb/overview?' + RANGE, pipeline.token);
    assert.equal(res.status, 404);
  });
});

describe('Reporting API — validation', () => {
  test('invalid product id is rejected', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/products/${''.padEnd(300, 'x')}?${RANGE}`, pipeline.token);
    assert.equal(res.status, 400);
  });

  test('missing from/to is rejected with INVALID_DATE_RANGE', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/overview`, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_DATE_RANGE');
  });

  test('from after to is rejected', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await get(
      `/api/reports/${pipeline.websiteId}/overview?from=2026-08-20T00:00:00.000Z&to=2026-08-01T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_DATE_RANGE');
  });

  test('an excessively large date range for the given granularity is rejected ("reasonable date range", §8)', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await get(
      `/api/reports/${pipeline.websiteId}/overview?from=2000-01-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&granularity=hour`,
      pipeline.token
    );
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_DATE_RANGE');
  });

  test('a malformed date string is rejected, not silently coerced', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/overview?from=hello&to=2026-08-20T00:00:00.000Z`, pipeline.token);
    assert.equal(res.status, 400);
  });
});

describe('Reporting API — performance: reads only aggregation collections (§15/§17/§19)', () => {
  test('a full sweep of every report endpoint never touches the Event repository', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({ bucket: new Date('2026-08-10T00:00:00.000Z'), pageViews: 10, orders: 1, grossRevenueMinor: 1000 });
    pipeline.seedProductBucket({ productId: 'p1', bucket: new Date('2026-08-10T00:00:00.000Z'), productViews: 5 });

    let eventRepositoryCalls = 0;
    for (const method of Object.keys(eventRepository)) {
      t.mock.method(eventRepository, method, async () => {
        eventRepositoryCalls += 1;
        throw new Error(`unexpected call to eventRepository.${method} from the reporting layer`);
      });
    }

    const endpoints = ['overview', 'timeseries', 'products', 'products/p1', 'conversion', 'cart-checkout', 'revenue'];
    for (const endpoint of endpoints) {
      const res = await get(`/api/reports/${pipeline.websiteId}/${endpoint}?${RANGE}`, pipeline.token);
      assert.equal(res.status, 200, `${endpoint} should succeed without touching Event`);
    }

    assert.equal(eventRepositoryCalls, 0);
  });
});
