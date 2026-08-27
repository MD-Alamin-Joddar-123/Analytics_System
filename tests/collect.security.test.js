import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { eventRepository } from '../src/repositories/event.repository.js';
import { makeFakeWebsite } from './helpers/fakeWebsite.js';
import { mockCommerceRepositories } from './helpers/mockCommerceRepositories.js';
import { mockEventQueueSuccess } from './helpers/mockEventQueue.js';

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

function mockActiveWebsite(t) {
  t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
    id === WEBSITE_ID ? makeFakeWebsite({ websiteId: WEBSITE_ID, status: 'active' }) : null
  );
  t.mock.method(eventRepository, 'findByWebsiteAndEventId', async () => null);
  mockCommerceRepositories(t);
  mockEventQueueSuccess(t);
}

describe('POST /api/collect — security', () => {
  test('no Authorization header / JWT is required', async (t) => {
    mockActiveWebsite(t);
    t.mock.method(eventRepository, 'create', async (doc) => ({ ...doc, _id: 'x' }));

    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId: WEBSITE_ID, event: 'page_view' }),
    });

    assert.equal(res.status, 202);
  });

  test('reflects an arbitrary customer-site Origin without requiring credentials', async (t) => {
    mockActiveWebsite(t);
    t.mock.method(eventRepository, 'create', async (doc) => ({ ...doc, _id: 'x' }));

    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://some-customer-store.example' },
      body: JSON.stringify({ websiteId: WEBSITE_ID, event: 'page_view' }),
    });

    assert.equal(res.status, 202);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://some-customer-store.example');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  });

  test('accepts a text/plain body (the CORS-safelisted content type sendBeacon must use)', async (t) => {
    mockActiveWebsite(t);
    t.mock.method(eventRepository, 'create', async (doc) => ({ ...doc, _id: 'x' }));

    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: 'https://some-customer-store.example' },
      body: JSON.stringify({ websiteId: WEBSITE_ID, event: 'page_view', url: 'https://shop.example/', path: '/' }),
    });

    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.data.accepted, true);
  });

  test('a text/plain body is parsed identically to an application/json one', async (t) => {
    mockActiveWebsite(t);
    let captured;
    t.mock.method(eventRepository, 'create', async (doc) => {
      captured = doc;
      return { ...doc, _id: 'x' };
    });

    await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        websiteId: WEBSITE_ID,
        event: 'product_view',
        anonymousId: 'anon-tp',
        sessionId: 'sess-tp',
        data: { productId: 'p1', price: 10, currency: 'USD' },
      }),
    });

    assert.equal(captured.eventName, 'product_view');
    assert.equal(captured.anonymousId, 'anon-tp');
    assert.equal(captured.data.productId, 'p1');
  });

  test('rejects a malformed (non-JSON) request body', async (t) => {
    mockActiveWebsite(t);
    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json at all {{{',
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
  });

  test('rejects an oversized payload', async (t) => {
    mockActiveWebsite(t);
    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId: WEBSITE_ID, event: 'page_view', title: 'x'.repeat(100 * 1024) }),
    });
    const body = await res.json();

    assert.equal(res.status, 413);
    assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  test('sensitive fields sent in `data` are never persisted', async (t) => {
    mockActiveWebsite(t);
    let captured;
    t.mock.method(eventRepository, 'create', async (doc) => {
      captured = doc;
      return { ...doc, _id: 'x' };
    });

    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        websiteId: WEBSITE_ID,
        event: 'add_to_cart',
        data: {
          productId: 'p1',
          price: 10,
          quantity: 1,
          password: 'hunter2',
          creditCard: '4111111111111111',
          cvv: '123',
          authorization: 'Bearer some-jwt',
          apiKey: 'sk_live_abc123',
        },
      }),
    });
    const body = await res.json();
    const rawCaptured = JSON.stringify(captured);

    assert.equal(res.status, 202);
    assert.equal(body.data.accepted, true);
    assert.deepEqual(captured.data, { productId: 'p1', price: 10, quantity: 1 });
    assert.ok(!rawCaptured.includes('hunter2'));
    assert.ok(!rawCaptured.includes('4111111111111111'));
    assert.ok(!rawCaptured.toLowerCase().includes('cvv'));
    assert.ok(!rawCaptured.toLowerCase().includes('apikey'));
  });

  test('sensitive top-level fields (e.g. a smuggled ownerId) have no effect', async (t) => {
    mockActiveWebsite(t);
    let captured;
    t.mock.method(eventRepository, 'create', async (doc) => {
      captured = doc;
      return { ...doc, _id: 'x' };
    });

    await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        websiteId: WEBSITE_ID,
        event: 'page_view',
        ownerId: 'someone-elses-id',
        _id: 'hacked-mongo-id',
      }),
    });

    assert.equal(captured.ownerId, undefined);
    assert.equal(captured._id, undefined);
  });
});
