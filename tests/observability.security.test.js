import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockObservabilityPipeline } from './helpers/mockObservabilityPipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';
import { signAuthToken } from '../src/utils/jwt.js';

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

function purchaseEvent(overrides = {}) {
  return {
    websiteId: WEBSITE_ID,
    event: 'purchase',
    anonymousId: 'anon-1',
    sessionId: 'sess-1',
    data: {
      orderId: 'order-1',
      revenue: 850,
      currency: 'USD',
      items: [{ productId: 'p1', name: 'Laptop', price: 850, quantity: 1 }],
    },
    ...overrides,
  };
}

const LIST_ENDPOINTS = ['visitors', 'sessions', 'events', 'orders'];
const DETAIL_ENDPOINTS = ['visitors/anon-1', 'sessions/sess-1', 'events/some-event-id', 'orders/order-1'];

describe('Tracking Observability — authentication', () => {
  test('every listing endpoint requires a valid JWT', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    for (const endpoint of LIST_ENDPOINTS) {
      const res = await get(`/api/reports/${pipeline.websiteId}/${endpoint}`);
      assert.equal(res.status, 401, endpoint);
      const body = await res.json();
      assert.equal(body.error.code, 'AUTH_REQUIRED', endpoint);
    }
  });

  test('every detail endpoint requires a valid JWT', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    for (const endpoint of DETAIL_ENDPOINTS) {
      const res = await get(`/api/reports/${pipeline.websiteId}/${endpoint}`);
      assert.equal(res.status, 401, endpoint);
    }
  });

  test('an invalid/garbage token is rejected', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get(`/api/reports/${pipeline.websiteId}/visitors`, 'not-a-real-token');
    assert.equal(res.status, 401);
  });
});

describe('Tracking Observability — website ownership', () => {
  test('a different authenticated user cannot list another user\'s activity', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t, { ownerId: 'owner-A' });
    await postAndProcess(baseUrl, purchaseEvent(), pipeline);

    const { userRepository } = await import('../src/repositories/user.repository.js');
    t.mock.method(userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });

    for (const endpoint of LIST_ENDPOINTS) {
      const res = await get(`/api/reports/${pipeline.websiteId}/${endpoint}`, attackerToken);
      const body = await res.json();
      assert.equal(res.status, 404, endpoint);
      assert.equal(body.error.code, 'WEBSITE_NOT_FOUND', endpoint);
      assert.equal(JSON.stringify(body).includes('order-1'), false, `${endpoint} must not leak data`);
    }

    const ownerRes = await get(`/api/reports/${pipeline.websiteId}/orders`, pipeline.token);
    assert.equal(ownerRes.status, 200);
  });

  test('never trusts a client-supplied ownerId query param', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t, { ownerId: 'owner-A' });
    const { userRepository } = await import('../src/repositories/user.repository.js');
    t.mock.method(userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });

    const res = await get(`/api/reports/${pipeline.websiteId}/visitors?ownerId=owner-A`, attackerToken);
    assert.equal(res.status, 404);
  });

  test('an invalid websiteId shape is rejected before any ownership/database lookup', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get('/api/reports/not-a-valid-website-id/visitors', pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_WEBSITE_ID');
  });

  test('a well-formed but non-existent websiteId is a safe 404, not a 500', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    const res = await get('/api/reports/ffffffffffffffff/visitors', pipeline.token);
    assert.equal(res.status, 404);
  });
});

describe('Tracking Observability — sensitive-field exclusion', () => {
  test('no endpoint ever exposes password/token/card fields, even nested', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    await postAndProcess(baseUrl, purchaseEvent(), pipeline);
    const eventId = [...pipeline.events.values()][0].eventId;

    const responses = await Promise.all([
      get(`/api/reports/${pipeline.websiteId}/visitors`, pipeline.token),
      get(`/api/reports/${pipeline.websiteId}/visitors/anon-1`, pipeline.token),
      get(`/api/reports/${pipeline.websiteId}/sessions`, pipeline.token),
      get(`/api/reports/${pipeline.websiteId}/sessions/sess-1`, pipeline.token),
      get(`/api/reports/${pipeline.websiteId}/events`, pipeline.token),
      get(`/api/reports/${pipeline.websiteId}/events/${eventId}`, pipeline.token),
      get(`/api/reports/${pipeline.websiteId}/orders`, pipeline.token),
      get(`/api/reports/${pipeline.websiteId}/orders/order-1`, pipeline.token),
    ]);

    const bodies = await Promise.all(responses.map((r) => r.json()));
    const forbiddenPatterns = [/password/i, /passwordHash/i, /cvv/i, /cardNumber/i, /"authorization"/i, /\bjwt\b/i, /"cookie"/i];
    for (const body of bodies) {
      const json = JSON.stringify(body);
      for (const pattern of forbiddenPatterns) {
        assert.equal(pattern.test(json), false, `${pattern} must never appear in ${json.slice(0, 80)}`);
      }
    }
  });
});

describe('Tracking Observability — performance: bounded pagination', () => {
  test('a limit far above the safe maximum is rejected on every listing endpoint', async (t) => {
    const pipeline = setupMockObservabilityPipeline(t);
    for (const endpoint of LIST_ENDPOINTS) {
      const res = await get(`/api/reports/${pipeline.websiteId}/${endpoint}?limit=999999`, pipeline.token);
      assert.equal(res.status, 400, endpoint);
    }
  });
});
