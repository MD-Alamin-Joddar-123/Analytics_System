import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { websiteTrackingConfigRepository } from '../src/repositories/websiteTrackingConfig.repository.js';
import { makeFakeWebsite } from './helpers/fakeWebsite.js';
import { env } from '../src/config/env.js';

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

function get(websiteId, origin) {
  return fetch(`${baseUrl}/api/config/${websiteId}`, {
    headers: origin ? { Origin: origin } : {},
  });
}

function mockWebsiteExists(t, overrides = {}) {
  t.mock.method(websiteRepository, 'findByWebsiteId', async (wId) =>
    wId === WEBSITE_ID ? makeFakeWebsite({ websiteId: WEBSITE_ID, status: 'active', ...overrides }) : null
  );
}

function makeFakeConfig(overrides = {}) {
  const fields = {
    _id: '66a1f0c9e1a2b3c4d5e6f7a9',
    websiteId: WEBSITE_ID,
    detectionMode: 'selector_regex',
    productUrlPattern: '/product/item/:id',
    productIdSource: 'url',
    productNameSelector: 'h1.product-title',
    orderCurrency: 'BDT',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
  return { ...fields, toJSON: () => fields };
}

describe('GET /api/config/:websiteId — public, no auth required', () => {
  test('never requires authentication — the SDK on an arbitrary customer site never holds a JWT', async (t) => {
    mockWebsiteExists(t);
    t.mock.method(websiteTrackingConfigRepository, 'findByWebsiteId', async () => makeFakeConfig());

    const res = await get(WEBSITE_ID);
    assert.equal(res.status, 200);
  });

  test('reflects an arbitrary cross-origin Origin, exactly like /tracking.js and /api/collect', async (t) => {
    mockWebsiteExists(t);
    t.mock.method(websiteTrackingConfigRepository, 'findByWebsiteId', async () => makeFakeConfig());

    const res = await get(WEBSITE_ID, 'https://some-customer-store.example');
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://some-customer-store.example');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  });

  test('returns the config wrapped in the standard success envelope', async (t) => {
    mockWebsiteExists(t);
    t.mock.method(websiteTrackingConfigRepository, 'findByWebsiteId', async () =>
      makeFakeConfig({ productNameSelector: '.title', orderCurrency: 'BDT' })
    );

    const res = await get(WEBSITE_ID);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.config.productNameSelector, '.title');
    assert.equal(body.data.config.orderCurrency, 'BDT');
  });

  test('never leaks the Mongo _id or any field outside the documented allow-list', async (t) => {
    mockWebsiteExists(t);
    t.mock.method(websiteTrackingConfigRepository, 'findByWebsiteId', async () => makeFakeConfig());

    const res = await get(WEBSITE_ID);
    const body = await res.json();
    assert.equal(Object.prototype.hasOwnProperty.call(body.data.config, '_id'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body.data.config, 'id'), false);
  });

  test('sets a short, cache-friendly Cache-Control and carries an ETag', async (t) => {
    mockWebsiteExists(t);
    t.mock.method(websiteTrackingConfigRepository, 'findByWebsiteId', async () => makeFakeConfig());

    const res = await get(WEBSITE_ID);
    assert.equal(res.headers.get('cache-control'), `public, max-age=${env.trackingConfigCacheSeconds}`);
    assert.ok(res.headers.get('etag'));
  });

  test('the cache window is short enough that an admin editing config sees it take effect promptly', async () => {
    assert.ok(
      env.trackingConfigCacheSeconds > 0 && env.trackingConfigCacheSeconds <= 60,
      `expected a cache window of 1-60s, got ${env.trackingConfigCacheSeconds}`
    );
  });

  test('a well-formed but unknown websiteId returns 404 WEBSITE_NOT_FOUND, not 500', async (t) => {
    t.mock.method(websiteRepository, 'findByWebsiteId', async () => null);

    const res = await get('ffffffffffffffff');
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
  });

  test('a malformed websiteId shape is rejected before any lookup', async (t) => {
    const res = await get('not-a-valid-id');
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_WEBSITE_ID');
  });

  test('a real website with no config saved yet returns 404 TRACKING_CONFIG_NOT_FOUND, not an empty 200', async (t) => {
    mockWebsiteExists(t);
    t.mock.method(websiteTrackingConfigRepository, 'findByWebsiteId', async () => null);

    const res = await get(WEBSITE_ID);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'TRACKING_CONFIG_NOT_FOUND');
  });

  test('a paused website\'s config is still fetchable — the config itself is inert, read-only data', async (t) => {
    mockWebsiteExists(t, { status: 'paused' });
    t.mock.method(websiteTrackingConfigRepository, 'findByWebsiteId', async () => makeFakeConfig());

    const res = await get(WEBSITE_ID);
    assert.equal(res.status, 200);
  });

  test('multi-tenant isolation: website A never receives website B\'s config', async (t) => {
    t.mock.method(websiteRepository, 'findByWebsiteId', async (wId) =>
      ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'].includes(wId) ? makeFakeWebsite({ websiteId: wId, status: 'active' }) : null
    );
    t.mock.method(websiteTrackingConfigRepository, 'findByWebsiteId', async (wId) =>
      makeFakeConfig({ websiteId: wId, productNameSelector: wId === 'aaaaaaaaaaaaaaaa' ? '.a-selector' : '.b-selector' })
    );

    const resA = await get('aaaaaaaaaaaaaaaa');
    const bodyA = await resA.json();
    assert.equal(bodyA.data.config.productNameSelector, '.a-selector');

    const resB = await get('bbbbbbbbbbbbbbbb');
    const bodyB = await resB.json();
    assert.equal(bodyB.data.config.productNameSelector, '.b-selector');
  });

  test('PUT to the public route is not handled here — falls through to the authenticated router (401, not 404)', async (t) => {
    mockWebsiteExists(t);
    const res = await fetch(`${baseUrl}/api/config/${WEBSITE_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });
});
