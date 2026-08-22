import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { makeFakeWebsite, makeFakeUserRecord } from './helpers/fakeWebsite.js';

const OWNER_A_ID = '507f1f77bcf86cd799439011';
const OWNER_B_ID = '507f191e810c19729de860ea';

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

describe('GET /api/websites', () => {
  test('a user sees only their own websites', async (t) => {
    mockAuthenticatedUsers(t);
    t.mock.method(websiteRepository, 'findByOwner', async (ownerId) => {
      if (ownerId === OWNER_A_ID) {
        return [
          makeFakeWebsite({ _id: 'a1', websiteId: 'idaaaaaaaaaaaaaa', ownerId: OWNER_A_ID, name: 'A Store 1' }),
          makeFakeWebsite({ _id: 'a2', websiteId: 'idbbbbbbbbbbbbbb', ownerId: OWNER_A_ID, name: 'A Store 2' }),
        ];
      }
      return [];
    });

    const res = await fetch(`${baseUrl}/api/websites`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.websites.length, 2);
    assert.ok(body.data.websites.every((w) => w.ownerId === undefined));
  });

  test('a user cannot see another user\'s websites', async (t) => {
    mockAuthenticatedUsers(t);
    t.mock.method(websiteRepository, 'findByOwner', async (ownerId) => {
      if (ownerId === OWNER_A_ID) {
        return [makeFakeWebsite({ _id: 'a1', ownerId: OWNER_A_ID, name: "A's private store" })];
      }
      return [];
    });

    const res = await fetch(`${baseUrl}/api/websites`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.websites.length, 0);
    assert.ok(!JSON.stringify(body).includes("A's private store"));
  });

  test('rejects an unauthenticated request', async () => {
    const res = await fetch(`${baseUrl}/api/websites`);
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });
});
