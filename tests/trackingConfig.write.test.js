import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { websiteTrackingConfigRepository } from '../src/repositories/websiteTrackingConfig.repository.js';
import { setupMockReportingPipeline } from './helpers/mockReportingPipeline.js';
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

function put(websiteId, body, token) {
  return fetch(`${baseUrl}/api/config/${websiteId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

function mockConfigRepo(t) {
  const store = new Map();
  t.mock.method(websiteTrackingConfigRepository, 'upsertByWebsiteId', async (websiteId, updates) => {
    const saved = { websiteId, ...updates, updatedAt: new Date() };
    store.set(websiteId, saved);
    return { ...saved, toJSON: () => saved };
  });
  return store;
}

const VALID_CONFIG = {
  detectionMode: 'selector_regex',
  productUrlPattern: '/product/item/:id',
  productIdSource: 'url',
  productNameSelector: 'h1.product-title',
  productPriceSelector: '.price',
  productPriceRegex: '([\\d.]+)',
  orderTriggerUrlPattern: '/my-orders/*',
  orderIdSelector: '.order-id',
  orderIdRegex: '#([a-f0-9-]+)',
  orderTotalSelector: '.order-total',
  orderTotalRegex: '([\\d.]+)\\s*BDT',
  orderCurrency: 'bdt',
  orderItemContainerSelector: '.order-item',
  orderItemIdSelector: '[data-product-id]::attr(data-product-id)',
  orderItemNameSelector: '.item-name',
  orderItemPriceSelector: '.item-price',
  orderItemQtySelector: '.item-qty',
};

describe('PUT /api/config/:websiteId — authenticated, dashboard-only', () => {
  test('requires a valid JWT', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);

    const res = await put(pipeline.websiteId, VALID_CONFIG);
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });

  test('a different authenticated user cannot save config for a website they do not own', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { ownerId: 'owner-A' });
    mockConfigRepo(t);
    t.mock.method((await import('../src/repositories/user.repository.js')).userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });

    const res = await put(pipeline.websiteId, VALID_CONFIG, attackerToken);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
  });

  test('never trusts a client-supplied ownerId — ownership is resolved from the JWT only', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { ownerId: 'owner-A' });
    mockConfigRepo(t);
    t.mock.method((await import('../src/repositories/user.repository.js')).userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });

    const res = await put(pipeline.websiteId, { ...VALID_CONFIG, ownerId: 'owner-A' }, attackerToken);
    assert.equal(res.status, 404);
  });

  test('an invalid websiteId shape is rejected before any ownership lookup', async (t) => {
    setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await put('not-a-valid-id', VALID_CONFIG, signAuthToken({ _id: 'user-1', role: 'user' }));
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_WEBSITE_ID');
  });

  test('a well-formed but non-existent websiteId is a safe 404', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await put('ffffffffffffffff', VALID_CONFIG, pipeline.token);
    assert.equal(res.status, 404);
  });

  test('a valid config from the real owner saves successfully', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);

    const res = await put(pipeline.websiteId, VALID_CONFIG, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.config.orderCurrency, 'BDT');
    assert.equal(body.data.config.productNameSelector, 'h1.product-title');
    assert.equal(body.data.config.orderItemIdSelector, '[data-product-id]::attr(data-product-id)');
  });

  test('never leaks the Mongo _id in the response', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await put(pipeline.websiteId, VALID_CONFIG, pipeline.token);
    const body = await res.json();
    assert.equal(Object.prototype.hasOwnProperty.call(body.data.config, '_id'), false);
  });

  test('rejects productIdSource "selector" without productIdSelector', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await put(pipeline.websiteId, { productIdSource: 'selector' }, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('accepts productIdSource "selector" WITH productIdSelector', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await put(
      pipeline.websiteId,
      { productIdSource: 'selector', productIdSelector: '[data-product-id]' },
      pipeline.token
    );
    assert.equal(res.status, 200);
  });

  test('rejects an unrecognized detectionMode', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await put(pipeline.websiteId, { detectionMode: 'not-a-real-mode' }, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects an invalid orderCurrency', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await put(pipeline.websiteId, { orderCurrency: 'NOTREAL' }, pipeline.token);
    assert.equal(res.status, 400);
  });

  test('rejects a syntactically invalid regex, never persisting it', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const store = mockConfigRepo(t);
    const res = await put(pipeline.websiteId, { orderTotalRegex: '(unclosed' }, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(store.has(pipeline.websiteId), false);
  });

  test('rejects a selector field over the length limit', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await put(pipeline.websiteId, { productNameSelector: 'x'.repeat(501) }, pipeline.token);
    assert.equal(res.status, 400);
  });

  test('an empty-string field is treated as "not configured", not saved as an empty string', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const store = mockConfigRepo(t);
    await put(pipeline.websiteId, { productNameSelector: '   ' }, pipeline.token);
    assert.equal(store.get(pipeline.websiteId).productNameSelector, undefined);
  });

  test('defaults detectionMode and productIdSource when omitted, so a fresh config is never ambiguous', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await put(pipeline.websiteId, {}, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.config.detectionMode, 'selector_regex');
    assert.equal(body.data.config.productIdSource, 'url');
  });

  test('POST is accepted as an alias for the same save handler', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await fetch(`${baseUrl}/api/config/${pipeline.websiteId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pipeline.token}` },
      body: JSON.stringify(VALID_CONFIG),
    });
    assert.equal(res.status, 200);
  });

  test('applies the restrictive (non-public) CORS policy, unlike the public GET route', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    mockConfigRepo(t);
    const res = await fetch(`${baseUrl}/api/config/${pipeline.websiteId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pipeline.token}`,
        Origin: 'https://some-random-attacker-site.example',
      },
      body: JSON.stringify(VALID_CONFIG),
    });
    assert.notEqual(res.headers.get('access-control-allow-origin'), 'https://some-random-attacker-site.example');
  });
});
