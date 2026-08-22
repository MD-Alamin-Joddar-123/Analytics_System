import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { makeFakeWebsite, makeFakeUserRecord } from './helpers/fakeWebsite.js';

const OWNER_A_ID = '507f1f77bcf86cd799439011';
const OWNER_B_ID = '507f191e810c19729de860ea';
const WEBSITE_ID = '66a1f0c9e1a2b3c4d5e6f7a8';

let server;
let baseUrl;
let tokenA;
let tokenB;

before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  tokenA = signAuthToken({ _id: OWNER_A_ID, role: 'user' });
  tokenB = signAuthToken({ _id: OWNER_B_ID, role: 'user' });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function mockAuthenticatedUsers(t) {
  t.mock.method(userRepository, 'findById', async (id) => {
    if (id === OWNER_A_ID || id === OWNER_B_ID) return makeFakeUserRecord(id);
    return null;
  });
}

async function getWebsite(id, token, t) {
  mockAuthenticatedUsers(t);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/api/websites/${id}`, { headers });
  return { res, body: await res.json() };
}

describe('GET /api/websites/:id', () => {
  test('the owner can retrieve their own website', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async (id, ownerId) =>
      id === WEBSITE_ID && ownerId === OWNER_A_ID ? makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID }) : null
    );

    const { res, body } = await getWebsite(WEBSITE_ID, tokenA, t);

    assert.equal(res.status, 200);
    assert.equal(body.data.website.id, WEBSITE_ID);
    assert.equal(body.data.website.ownerId, undefined);
  });

  test('another user cannot retrieve it (returns 404, not 403, to avoid confirming existence)', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async (id, ownerId) =>
      id === WEBSITE_ID && ownerId === OWNER_A_ID ? makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID }) : null
    );

    const { res, body } = await getWebsite(WEBSITE_ID, tokenB, t);

    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
  });

  test('rejects an unauthenticated request', async (t) => {
    const { res, body } = await getWebsite(WEBSITE_ID, null, t);
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });

  test('handles a malformed MongoDB id safely', async (t) => {
    const { res, body } = await getWebsite('not-a-valid-object-id', tokenA, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_WEBSITE_ID');
  });

  test('handles a well-formed but non-existent id safely', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async () => null);
    const { res, body } = await getWebsite('ffffffffffffffffffffffff', tokenA, t);
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
  });
});
