import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { makeFakeWebsite, makeFakeUserRecord } from './helpers/fakeWebsite.js';

const OWNER_A_ID = '507f1f77bcf86cd799439011';

let server;
let baseUrl;
let tokenA;

before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  tokenA = signAuthToken({ _id: OWNER_A_ID, role: 'user' });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function createWebsite(body, { token = tokenA, mockUser = true, t } = {}) {
  if (mockUser) {
    t.mock.method(userRepository, 'findById', async () => makeFakeUserRecord(OWNER_A_ID));
  }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}/api/websites`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { res, body: await res.json() };
}

const validPayload = {
  name: 'My Ecommerce Store',
  domain: 'https://example.com',
  timezone: 'Asia/Dhaka',
  currency: 'BDT',
};

describe('POST /api/websites', () => {
  test('an authenticated user can create a website with an auto-generated websiteId', async (t) => {
    t.mock.method(websiteRepository, 'findByWebsiteId', async () => null);
    let captured;
    t.mock.method(websiteRepository, 'create', async (args) => {
      captured = args;
      return makeFakeWebsite({ ...args, _id: '66a1f0c9e1a2b3c4d5e6f7a8' });
    });

    const { res, body } = await createWebsite(validPayload, { t });

    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    const { website } = body.data;

    assert.equal(website.name, 'My Ecommerce Store');
    assert.equal(website.domain, 'example.com');
    assert.equal(website.timezone, 'Asia/Dhaka');
    assert.equal(website.currency, 'BDT');
    assert.equal(website.status, 'active');
    assert.equal(website.ownerId, undefined);

    assert.match(website.websiteId, /^[a-f0-9]{16}$/);
    assert.notEqual(website.websiteId, website.id);
    assert.equal(captured.websiteId, website.websiteId);
    assert.equal(captured.ownerId, OWNER_A_ID);
  });

  test('rejects an unauthenticated request', async (t) => {
    const { res, body } = await createWebsite(validPayload, { token: null, mockUser: false, t });
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });

  test('retries websiteId generation on a collision and still succeeds', async (t) => {
    let findByWebsiteIdCalls = 0;
    t.mock.method(websiteRepository, 'findByWebsiteId', async () => {
      findByWebsiteIdCalls += 1;
      return findByWebsiteIdCalls === 1 ? makeFakeWebsite() : null;
    });
    t.mock.method(websiteRepository, 'create', async (args) => makeFakeWebsite(args));

    const { res, body } = await createWebsite(validPayload, { t });

    assert.equal(res.status, 201);
    assert.ok(findByWebsiteIdCalls >= 2);
    assert.match(body.data.website.websiteId, /^[a-f0-9]{16}$/);
  });

  test('ownerId always comes from the authenticated user, never the client', async (t) => {
    t.mock.method(websiteRepository, 'findByWebsiteId', async () => null);
    let captured;
    t.mock.method(websiteRepository, 'create', async (args) => {
      captured = args;
      return makeFakeWebsite(args);
    });

    await createWebsite({ ...validPayload, ownerId: 'someone-elses-user-id' }, { t });

    assert.equal(captured.ownerId, OWNER_A_ID);
    assert.notEqual(captured.ownerId, 'someone-elses-user-id');
  });

  test('client-supplied websiteId is ignored; the server always generates its own', async (t) => {
    t.mock.method(websiteRepository, 'findByWebsiteId', async () => null);
    let captured;
    t.mock.method(websiteRepository, 'create', async (args) => {
      captured = args;
      return makeFakeWebsite(args);
    });

    await createWebsite({ ...validPayload, websiteId: 'client-supplied-id' }, { t });

    assert.notEqual(captured.websiteId, 'client-supplied-id');
    assert.match(captured.websiteId, /^[a-f0-9]{16}$/);
  });

  test('rejects an invalid domain', async (t) => {
    const { res, body } = await createWebsite({ ...validPayload, domain: 'not a domain!!' }, { t });
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_DOMAIN');
  });

  test('rejects an invalid timezone', async (t) => {
    const { res, body } = await createWebsite({ ...validPayload, timezone: 'Not/AZone' }, { t });
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects an invalid currency', async (t) => {
    const { res, body } = await createWebsite({ ...validPayload, currency: 'ZZZ' }, { t });
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects a missing name', async (t) => {
    const { name, ...rest } = validPayload;
    const { res, body } = await createWebsite(rest, { t });
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });
});
