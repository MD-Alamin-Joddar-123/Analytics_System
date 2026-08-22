import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { eventRepository } from '../src/repositories/event.repository.js';
import { makeFakeWebsite } from './helpers/fakeWebsite.js';

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

function mockPassthroughRepos(t) {
  t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
    id === WEBSITE_ID ? makeFakeWebsite({ websiteId: WEBSITE_ID, status: 'active' }) : null
  );
  t.mock.method(eventRepository, 'existsByWebsiteAndEventId', async () => false);
  t.mock.method(eventRepository, 'create', async (doc) => ({ ...doc, _id: 'fakeMongoId' }));
}

async function collect(body, t) {
  mockPassthroughRepos(t);
  const res = await fetch(`${baseUrl}/api/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: await res.json() };
}

const base = { websiteId: WEBSITE_ID, event: 'page_view' };

describe('POST /api/collect — validation', () => {
  test('rejects a missing websiteId', async (t) => {
    const { res, body } = await collect({ event: 'page_view' }, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects a missing event', async (t) => {
    const { res, body } = await collect({ websiteId: WEBSITE_ID }, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects an unsupported event name', async (t) => {
    const { res, body } = await collect({ websiteId: WEBSITE_ID, event: 'teleport' }, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'UNSUPPORTED_EVENT');
  });

  test('rejects a reserved-but-not-yet-enabled future event name', async (t) => {
    const { res, body } = await collect({ websiteId: WEBSITE_ID, event: 'wishlist_add' }, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'UNSUPPORTED_EVENT');
  });

  test('rejects a malformed websiteId', async (t) => {
    const { res, body } = await collect({ ...base, websiteId: 'not-a-valid-website-id' }, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_WEBSITE_ID');
  });

  test('rejects an unparseable timestamp', async (t) => {
    const { res, body } = await collect({ ...base, timestamp: 'not-a-date' }, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_TIMESTAMP');
  });

  test('rejects a far-future timestamp', async (t) => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1 hour
    const { res, body } = await collect({ ...base, timestamp: future }, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_TIMESTAMP');
  });

  test('rejects a malformed URL', async (t) => {
    const { res, body } = await collect({ ...base, url: 'not a url' }, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects ecommerce data missing a required field (add_to_cart without productId)', async (t) => {
    const { res, body } = await collect(
      { websiteId: WEBSITE_ID, event: 'add_to_cart', data: { price: 10, quantity: 1 } },
      t
    );
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_DATA');
  });

  test('rejects a negative price', async (t) => {
    const { res, body } = await collect(
      { websiteId: WEBSITE_ID, event: 'add_to_cart', data: { productId: 'p1', price: -5, quantity: 1 } },
      t
    );
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_DATA');
  });

  test('rejects an invalid quantity (zero)', async (t) => {
    const { res, body } = await collect(
      { websiteId: WEBSITE_ID, event: 'add_to_cart', data: { productId: 'p1', price: 10, quantity: 0 } },
      t
    );
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_DATA');
  });

  test('rejects an invalid (negative) revenue', async (t) => {
    const { res, body } = await collect(
      {
        websiteId: WEBSITE_ID,
        event: 'purchase',
        data: { orderId: 'O1', revenue: -1, currency: 'USD', items: [{ productId: 'p1', price: 1, quantity: 1 }] },
      },
      t
    );
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_DATA');
  });

  test('rejects an invalid currency code', async (t) => {
    const { res, body } = await collect(
      { websiteId: WEBSITE_ID, event: 'add_to_cart', data: { productId: 'p1', price: 10, quantity: 1, currency: 'ZZZ' } },
      t
    );
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_DATA');
  });

  test('rejects an oversized raw payload (413)', async (t) => {
    mockPassthroughRepos(t);
    const hugeTitle = 'x'.repeat(64 * 1024); // 64KB, well over the 32KB collector limit
    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, title: hugeTitle }),
    });
    const body = await res.json();
    assert.equal(res.status, 413);
    assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  test('rejects an excessive item count in checkout', async (t) => {
    const items = Array.from({ length: 101 }, (_, i) => ({ productId: `p${i}`, price: 1, quantity: 1 }));
    const { res, body } = await collect(
      { websiteId: WEBSITE_ID, event: 'checkout', data: { items, cartValue: 101, currency: 'USD' } },
      t
    );
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_DATA');
  });

  test('rejects an invalid eventId format', async (t) => {
    const { res, body } = await collect({ ...base, eventId: 'has a space' }, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_EVENT_ID');
  });

  test('rejects a malformed request body (array instead of object)', async (t) => {
    mockPassthroughRepos(t);
    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects syntactically invalid JSON', async (t) => {
    mockPassthroughRepos(t);
    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });
});
