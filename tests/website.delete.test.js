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

async function deleteWebsite(id, token, t) {
  mockAuthenticatedUsers(t);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/api/websites/${id}`, { method: 'DELETE', headers });
  return { res, body: await res.json() };
}

describe('DELETE /api/websites/:id (soft archive)', () => {
  test('the repository exposes no hard-delete method — archiving is the only lifecycle transition', () => {
    assert.equal(typeof websiteRepository.delete, 'undefined');
    assert.equal(typeof websiteRepository.deleteOne, 'undefined');
    assert.equal(typeof websiteRepository.remove, 'undefined');
    assert.equal(typeof websiteRepository.archiveByIdAndOwner, 'function');
  });

  test('the owner can archive their website, and the response reflects the new status', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async () =>
      makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID, status: 'active' })
    );
    t.mock.method(websiteRepository, 'archiveByIdAndOwner', async () =>
      makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID, status: 'archived' })
    );

    const { res, body } = await deleteWebsite(WEBSITE_ID, tokenA, t);

    assert.equal(res.status, 200);
    assert.equal(body.data.website.status, 'archived');
  });

  test('another user cannot archive it', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async (id, ownerId) =>
      id === WEBSITE_ID && ownerId === OWNER_A_ID ? makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID }) : null
    );

    const { res, body } = await deleteWebsite(WEBSITE_ID, tokenB, t);

    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
  });

  test('archiving an already-archived website is idempotent (no error)', async (t) => {
    t.mock.method(websiteRepository, 'findByIdAndOwner', async () =>
      makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID, status: 'archived' })
    );
    let archiveCalled = false;
    t.mock.method(websiteRepository, 'archiveByIdAndOwner', async () => {
      archiveCalled = true;
      return makeFakeWebsite({ _id: WEBSITE_ID, ownerId: OWNER_A_ID, status: 'archived' });
    });

    const { res, body } = await deleteWebsite(WEBSITE_ID, tokenA, t);

    assert.equal(res.status, 200);
    assert.equal(body.data.website.status, 'archived');
    assert.equal(archiveCalled, false);
  });

  test('rejects an unauthenticated request', async (t) => {
    const { res, body } = await deleteWebsite(WEBSITE_ID, null, t);
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });
});
