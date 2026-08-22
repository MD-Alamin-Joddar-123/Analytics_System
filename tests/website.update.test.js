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

async function patchWebsite(id, token, payload, t) {
  mockAuthenticatedUsers(t);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/api/websites/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
  return { res, body: await res.json() };
}

describe('PATCH /api/websites/:id', () => {
  test('the owner can update allowed fields', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async (id, ownerId) =>
      id === WEBSITE_ID && ownerId === OWNER_A_ID ? makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID }) : null
    );
    t.mock.method(websiteRepository, 'updateByIdAndOwner', async (id, ownerId, updates) =>
      makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID, ...updates })
    );

    const { res, body } = await patchWebsite(WEBSITE_ID, tokenA, { name: 'Renamed Store' }, t);

    assert.equal(res.status, 200);
    assert.equal(body.data.website.name, 'Renamed Store');
  });

  test('another user cannot update it', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async (id, ownerId) =>
      id === WEBSITE_ID && ownerId === OWNER_A_ID ? makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID }) : null
    );

    const { res, body } = await patchWebsite(WEBSITE_ID, tokenB, { name: 'Hijacked Name' }, t);

    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
  });

  test('websiteId, ownerId, and _id cannot be changed via the request body', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async () =>
      makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID })
    );
    let capturedUpdates;
    t.mock.method(websiteRepository, 'updateByIdAndOwner', async (id, ownerId, updates) => {
      capturedUpdates = updates;
      return makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID, ...updates });
    });

    await patchWebsite(
      WEBSITE_ID,
      tokenA,
      { name: 'Still Allowed', websiteId: 'hacked-id', ownerId: 'hacked-owner', _id: 'hacked-mongo-id' },
      t
    );

    assert.equal(capturedUpdates.name, 'Still Allowed');
    assert.equal('websiteId' in capturedUpdates, false);
    assert.equal('ownerId' in capturedUpdates, false);
    assert.equal('_id' in capturedUpdates, false);
  });

  test('rejects setting status to "archived" via PATCH (must use DELETE)', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async () =>
      makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID, status: 'active' })
    );

    const { res, body } = await patchWebsite(WEBSITE_ID, tokenA, { status: 'archived' }, t);

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_WEBSITE_STATUS');
  });

  test('rejects invalid fields (bad currency)', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async () =>
      makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID })
    );

    const { res, body } = await patchWebsite(WEBSITE_ID, tokenA, { currency: 'ZZZ' }, t);

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects an empty update body', async (t) => {
    const { res, body } = await patchWebsite(WEBSITE_ID, tokenA, {}, t);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects updates to an archived website', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async () =>
      makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID, status: 'archived' })
    );

    const { res, body } = await patchWebsite(WEBSITE_ID, tokenA, { name: 'Trying anyway' }, t);

    assert.equal(res.status, 409);
    assert.equal(body.error.code, 'WEBSITE_ARCHIVED');
  });
});
