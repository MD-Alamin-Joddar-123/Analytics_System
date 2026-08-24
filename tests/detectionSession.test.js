import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { setupMockReportingPipeline } from './helpers/mockReportingPipeline.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { DetectionSession, DETECTION_SESSION_TTL_MS } from '../src/models/DetectionSession.js';

// Browser-rendered-DOM Auto Detect sessions: dashboard-facing create/poll
// (JWT + ownership) and tracking.js-facing result submission (token-only,
// URL-locked, expiring). The DetectionSession MODEL is mocked at its
// statics boundary (same "mock at the test boundary" philosophy as every
// repository mock in this suite) with a tiny in-memory store — the routes,
// validators, controller, and the full state machine in
// detectionSession.service.js all run for real.

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

// Emulates exactly what real Mongoose gives the service: schema defaults
// applied, Date instances preserved.
function makeDoc(input) {
  return {
    _id: crypto.randomUUID(),
    sessionId: input.sessionId ?? crypto.randomBytes(24).toString('hex'),
    websiteId: input.websiteId,
    createdByUserId: input.createdByUserId,
    productUrl: input.productUrl ?? null,
    orderUrl: input.orderUrl ?? null,
    status: input.status ?? 'pending',
    productResult: null,
    orderResult: null,
    failureReason: null,
    expiresAt: input.expiresAt ?? new Date(Date.now() + DETECTION_SESSION_TTL_MS),
  };
}

function mockSessionModel(t) {
  const store = new Map();

  t.mock.method(DetectionSession, 'create', async (input) => {
    const doc = makeDoc(input);
    store.set(doc.sessionId, doc);
    return doc;
  });

  t.mock.method(DetectionSession, 'findOne', (query) => ({
    // Real Mongoose's static findOne returns a Query SYNCHRONOUSLY and the
    // service chains .lean() onto it before awaiting — so this replacement
    // must be synchronous too, only .lean() being async.
    lean: async () => store.get(query.sessionId) ?? null,
  }));

  t.mock.method(DetectionSession, 'updateOne', async (query, { $set }) => {
    // The service addresses documents by _id here (sessionId elsewhere).
    const doc = [...store.values()].find((d) => d._id === query._id || d.sessionId === query.sessionId);
    if (doc) Object.assign(doc, $set);
    return { acknowledged: true };
  });

  return {
    store,
    expire(sessionId) {
      store.get(sessionId).expiresAt = new Date(Date.now() - 1000);
    },
  };
}

function postJson(path, body, token) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

function getSession(path, token) {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function createSession(pipeline, body) {
  const res = await postJson(
    '/api/detection/session',
    { websiteId: pipeline.websiteId, ...body },
    pipeline.token
  );
  const json = await res.json();
  return { res, body: json.data ?? json };
}

describe('POST /api/detection/session', () => {
  test('requires a valid JWT', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const res = await postJson('/api/detection/session', { websiteId: pipeline.websiteId, productUrl: 'https://shop.example.com/products/1' });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });

  test('a user cannot create a session for a website they do not own', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t, { ownerId: 'owner-A' });
    t.mock.method((await import('../src/repositories/user.repository.js')).userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });

    const res = await postJson('/api/detection/session', { websiteId: pipeline.websiteId, productUrl: 'https://shop.example.com/products/1' }, attackerToken);
    assert.equal(res.status, 404);
  });

  test('rejects a request with neither URL', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const { res, body } = await createSession(pipeline, {});
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'DETECTION_SESSION_INVALID_BODY');
  });

  test('creates an expiring, random-token session owned by the caller', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const before = Date.now();
    const { res, body } = await createSession(pipeline, {
      productUrl: 'https://shop.example.com/products/rui',
      orderUrl: 'https://shop.example.com/thank-you',
    });

    assert.equal(res.status, 201);
    assert.match(body.sessionId, /^[a-f0-9]{48}$/); // 24 crypto-random bytes
    assert.equal(body.websiteId, pipeline.websiteId);
    assert.equal(body.status, 'pending');
    assert.equal(body.productResult, null);
    assert.equal(body.orderResult, null);
    const ttl = Date.parse(body.expiresAt) - before;
    assert.ok(ttl > DETECTION_SESSION_TTL_MS - 2000 && ttl < DETECTION_SESSION_TTL_MS + 5000);
  });
});

describe('GET /api/detection/session/:sessionId', () => {
  test('404s for an unknown session id', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const res = await getSession(`/api/detection/session/${'a'.repeat(48)}`, pipeline.token);
    assert.equal(res.status, 404);
  });

  test('the owner polls status and results', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const created = (await createSession(pipeline, { productUrl: 'https://shop.example.com/products/rui' })).body;

    const res = await getSession(`/api/detection/session/${created.sessionId}`, pipeline.token);
    const body = (await res.json()).data;
    assert.equal(res.status, 200);
    assert.equal(body.status, 'pending');
    assert.equal(body.productUrl, 'https://shop.example.com/products/rui');
  });

  test("another user cannot read someone else's session", async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t, { ownerId: 'owner-A' });
    t.mock.method((await import('../src/repositories/user.repository.js')).userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });
    const created = (
      await createSession(pipeline, { productUrl: 'https://shop.example.com/products/rui' })
    ).body;
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });

    const res = await getSession(`/api/detection/session/${created.sessionId}`, attackerToken);
    assert.equal(res.status, 404);
  });
});

const PRODUCT_RESULT_FIELDS = {
  productName: { selector: 'h1.product-title', value: 'Rui Fish', confidence: 'high', strategy: 'semantic-html' },
  productPrice: { selector: '.price', value: '799.00', confidence: 'medium', strategy: 'class-heuristic' },
};

const ORDER_RESULT_FIELDS = {
  orderId: { selector: '.order-number', value: '#4a15ae8f', confidence: 'high', strategy: 'label-proximity' },
  orderTotal: { selector: '.grand-total', value: '119960.00 BDT', confidence: 'high', strategy: 'label-proximity' },
  // Currency is a page VALUE, not an element — no selector (JSON never
  // carries `selector: undefined`; the validator tolerates absent keys).
  orderCurrency: { value: 'BDT', confidence: 'high', strategy: 'total-text-mark' },
};

describe('POST /api/detection/result (tracking.js submissions)', () => {
  test('rejects malformed session ids and unknown sessions without leaking state', async (t) => {
    mockSessionModel(t);
    const bad = await postJson('/api/detection/result', { sessionId: 'short', url: 'https://shop.example.com/products/rui', stage: 'start' });
    assert.equal(bad.status, 400);

    const unknown = await postJson('/api/detection/result', {
      sessionId: 'b'.repeat(48),
      url: 'https://shop.example.com/products/rui',
      stage: 'start',
    });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, 'DETECTION_SESSION_NOT_FOUND');
  });

  test('full two-side lifecycle advances pending -> product_detecting -> product_completed -> completed', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const session = (
      await createSession(pipeline, {
        productUrl: 'https://shop.example.com/products/rui',
        orderUrl: 'https://shop.example.com/thank-you',
      })
    ).body;

    let res = await postJson('/api/detection/result', { sessionId: session.sessionId, url: 'https://shop.example.com/products/rui?utm_source=email', stage: 'start' });
    assert.equal((await res.json()).data.status, 'product_detecting');

    // Query strings on the registered page must not break matching —
    // thank-you/order pages routinely carry ids around.
    res = await postJson('/api/detection/result', {
      sessionId: session.sessionId,
      url: 'https://shop.example.com/products/rui/',
      stage: 'complete',
      fields: PRODUCT_RESULT_FIELDS,
    });
    let body = (await res.json()).data;
    assert.equal(res.status, 200);
    assert.equal(body.status, 'product_completed'); // order side still outstanding
    assert.deepEqual(body.productResult, PRODUCT_RESULT_FIELDS);

    res = await postJson('/api/detection/result', { sessionId: session.sessionId, url: 'https://shop.example.com/thank-you?order=9', stage: 'complete', fields: ORDER_RESULT_FIELDS });
    body = (await res.json()).data;
    assert.equal(res.status, 200);
    assert.equal(body.status, 'completed');
    assert.deepEqual(body.orderResult, ORDER_RESULT_FIELDS);

    // The dashboard poller sees everything:
    const polled = (await (await getSession(`/api/detection/session/${session.sessionId}`, pipeline.token)).json()).data;
    assert.equal(polled.status, 'completed');
    assert.deepEqual(polled.productResult, PRODUCT_RESULT_FIELDS);
    assert.deepEqual(polled.orderResult, ORDER_RESULT_FIELDS);
  });

  test('a product-only session completes immediately', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const session = (await createSession(pipeline, { productUrl: 'https://shop.example.com/products/rui' })).body;

    const res = await postJson('/api/detection/result', {
      sessionId: session.sessionId,
      url: 'https://shop.example.com/products/rui',
      stage: 'complete',
      fields: PRODUCT_RESULT_FIELDS,
    });
    assert.equal((await res.json()).data.status, 'completed');
  });

  test('a submission from an unrelated URL is rejected', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const session = (await createSession(pipeline, { productUrl: 'https://shop.example.com/products/rui' })).body;

    const res = await postJson('/api/detection/result', {
      sessionId: session.sessionId,
      url: 'https://evil.example.com/products/rui',
      stage: 'complete',
      fields: PRODUCT_RESULT_FIELDS,
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'DETECTION_SESSION_URL_MISMATCH');
  });

  test('an expired session rejects submissions with 410', async (t) => {
    const db = mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const session = (await createSession(pipeline, { productUrl: 'https://shop.example.com/products/rui' })).body;
    db.expire(session.sessionId);

    const res = await postJson('/api/detection/result', { sessionId: session.sessionId, url: 'https://shop.example.com/products/rui', stage: 'start' });
    assert.equal(res.status, 410);
    assert.equal((await res.json()).error.code, 'DETECTION_SESSION_EXPIRED');

    // ...and the owner's poller sees the same expiry instead of stale hope:
    const pollRes = await getSession(`/api/detection/session/${session.sessionId}`, pipeline.token);
    assert.equal(pollRes.status, 410);
  });

  test('fail stage records why detection failed', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const session = (await createSession(pipeline, { orderUrl: 'https://shop.example.com/thank-you' })).body;

    const res = await postJson('/api/detection/result', {
      sessionId: session.sessionId,
      url: 'https://shop.example.com/thank-you',
      stage: 'fail',
      reason: 'No recognizable product or order markers found in rendered DOM',
    });
    const body = (await res.json()).data;
    assert.equal(body.status, 'failed');
    assert.match(body.failureReason, /No recognizable/);
  });

  test('oversized field payloads are rejected outright', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const session = (await createSession(pipeline, { productUrl: 'https://shop.example.com/products/rui' })).body;

    const bloated = {
      junk: { selector: 'x'.repeat(17 * 1024), value: 'y', confidence: 'low' },
    };
    const res = await postJson('/api/detection/result', {
      sessionId: session.sessionId,
      url: 'https://shop.example.com/products/rui',
      stage: 'complete',
      fields: bloated,
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'DETECTION_SESSION_INVALID_BODY');
  });

  test('rate limits hammering the same session token', async (t) => {
    mockSessionModel(t);
    const pipeline = setupMockReportingPipeline(t);
    const session = (await createSession(pipeline, { productUrl: 'https://shop.example.com/products/rui' })).body;

    let last;
    for (let i = 0; i < 35; i++) {
      last = await postJson('/api/detection/result', { sessionId: session.sessionId, url: 'https://shop.example.com/products/rui', stage: 'start' });
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429);
  });
});
