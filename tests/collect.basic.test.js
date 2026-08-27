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

function mockActiveWebsite(t, overrides = {}) {
  t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
    id === WEBSITE_ID ? makeFakeWebsite({ websiteId: WEBSITE_ID, status: 'active', ...overrides }) : null
  );
}

async function collect(body, t) {
  mockActiveWebsite(t);
  mockCommerceRepositories(t);
  mockEventQueueSuccess(t);
  t.mock.method(eventRepository, 'findByWebsiteAndEventId', async () => null);
  let captured;
  t.mock.method(eventRepository, 'create', async (doc) => {
    captured = doc;
    return { ...doc, _id: 'fakeMongoId' };
  });

  const res = await fetch(`${baseUrl}/api/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: await res.json(), captured };
}

describe('POST /api/collect — supported event types', () => {
  test('valid page_view', async (t) => {
    const { res, body, captured } = await collect(
      { websiteId: WEBSITE_ID, event: 'page_view', url: 'https://store.com/', path: '/', title: 'Home' },
      t
    );

    assert.equal(res.status, 202);
    assert.equal(body.success, true);
    assert.equal(body.data.accepted, true);
    assert.match(body.data.eventId, /^[0-9a-f-]{36}$/);
    assert.equal(captured.eventName, 'page_view');
    assert.equal(captured.data, undefined);
  });

  test('valid product_view', async (t) => {
    const { res, body, captured } = await collect(
      {
        websiteId: WEBSITE_ID,
        event: 'product_view',
        url: 'https://store.com/product/123',
        data: { productId: 'p123', name: 'Laptop', price: 85000, currency: 'BDT' },
      },
      t
    );

    assert.equal(res.status, 202);
    assert.equal(body.data.accepted, true);
    assert.deepEqual(captured.data, { productId: 'p123', name: 'Laptop', price: 85000, currency: 'BDT' });
  });

  test('valid add_to_cart', async (t) => {
    const { res, captured } = await collect(
      {
        websiteId: WEBSITE_ID,
        event: 'add_to_cart',
        data: { productId: 'p123', name: 'Laptop', price: 85000, quantity: 2, currency: 'BDT' },
      },
      t
    );

    assert.equal(res.status, 202);
    assert.deepEqual(captured.data, { productId: 'p123', name: 'Laptop', price: 85000, quantity: 2, currency: 'BDT' });
  });

  test('valid remove_from_cart', async (t) => {
    const { res, captured } = await collect(
      { websiteId: WEBSITE_ID, event: 'remove_from_cart', data: { productId: 'p123', price: 85000, quantity: 1 } },
      t
    );

    assert.equal(res.status, 202);
    assert.equal(captured.data.productId, 'p123');
    assert.equal(captured.data.quantity, 1);
  });

  test('valid checkout', async (t) => {
    const { res, captured } = await collect(
      {
        websiteId: WEBSITE_ID,
        event: 'checkout',
        data: {
          items: [{ productId: 'p1', price: 100, quantity: 2 }, { productId: 'p2', price: 50, quantity: 1 }],
          cartValue: 250,
          currency: 'BDT',
        },
      },
      t
    );

    assert.equal(res.status, 202);
    assert.equal(captured.data.items.length, 2);
    assert.equal(captured.data.cartValue, 250);
  });

  test('valid purchase', async (t) => {
    const { res, body, captured } = await collect(
      {
        websiteId: WEBSITE_ID,
        event: 'purchase',
        data: {
          orderId: 'ORDER-123',
          revenue: 170000,
          currency: 'BDT',
          items: [{ productId: 'p1', name: 'Laptop', price: 85000, quantity: 2 }],
        },
      },
      t
    );

    assert.equal(res.status, 202);
    assert.equal(body.data.accepted, true);
    assert.equal(captured.data.orderId, 'ORDER-123');
    assert.equal(captured.data.revenue, 170000);
    assert.equal(captured.eventVersion, '1');
  });
});
