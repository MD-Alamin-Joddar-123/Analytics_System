import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { makeFakeWebsite, makeFakeUserRecord } from './helpers/fakeWebsite.js';


const OWNER_A_ID = '507f1f77bcf86cd799439011';
const OWNER_B_ID = '507f191e810c19729de860ea';
const WEBSITE_A_ID = '66a1f0c9e1a2b3c4d5e6f7a8';

let server;
let baseUrl;
let tokenA;
let tokenB;
let store;

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

function mockOwnershipEnforcingRepository(t) {
  t.mock.method(userRepository, 'findById', async (id) => {
    if (id === OWNER_A_ID || id === OWNER_B_ID) return makeFakeUserRecord(id);
    return null;
  });

  t.mock.method(websiteRepository, 'findByIdAndOwner', async (id, ownerId) => {
    if (id === store.id && ownerId === store.ownerId) return { ...store };
    return null;
  });
  t.mock.method(websiteRepository, 'updateByIdAndOwner', async (id, ownerId, updates) => {
    if (id === store.id && ownerId === store.ownerId) {
      Object.assign(store, updates);
      return { ...store };
    }
    return null;
  });
  t.mock.method(websiteRepository, 'archiveByIdAndOwner', async (id, ownerId) => {
    if (id === store.id && ownerId === store.ownerId) {
      store.status = 'archived';
      return { ...store };
    }
    return null;
  });
}

describe('Cross-user ownership isolation (User A owns Website A, User B attacks it)', () => {
  test('User B cannot GET Website A', async (t) => {
    store = makeFakeWebsite({ _id: WEBSITE_A_ID, ownerId: OWNER_A_ID, name: 'Website A' });
    store.id = WEBSITE_A_ID;
    mockOwnershipEnforcingRepository(t);

    const res = await fetch(`${baseUrl}/api/websites/${WEBSITE_A_ID}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
    assert.ok(!JSON.stringify(body).includes('Website A'));

    const ownerRes = await fetch(`${baseUrl}/api/websites/${WEBSITE_A_ID}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(ownerRes.status, 200);
  });

  test('User B cannot PATCH Website A', async (t) => {
    store = makeFakeWebsite({ _id: WEBSITE_A_ID, ownerId: OWNER_A_ID, name: 'Website A' });
    store.id = WEBSITE_A_ID;
    mockOwnershipEnforcingRepository(t);

    const res = await fetch(`${baseUrl}/api/websites/${WEBSITE_A_ID}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed by attacker' }),
    });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
    assert.equal(store.name, 'Website A');
  });

  test('User B cannot DELETE (archive) Website A', async (t) => {
    store = makeFakeWebsite({ _id: WEBSITE_A_ID, ownerId: OWNER_A_ID, name: 'Website A', status: 'active' });
    store.id = WEBSITE_A_ID;
    mockOwnershipEnforcingRepository(t);

    const res = await fetch(`${baseUrl}/api/websites/${WEBSITE_A_ID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
    assert.equal(store.status, 'active');
  });
});
