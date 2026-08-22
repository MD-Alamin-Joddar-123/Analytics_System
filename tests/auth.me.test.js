import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';
import { makeFakeUser } from './helpers/fakeUser.js';

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

async function getMe(headers) {
  const res = await fetch(`${baseUrl}/api/auth/me`, { headers });
  return { res, body: await res.json() };
}

describe('GET /api/auth/me', () => {
  test('returns the authenticated user with a valid token', async (t) => {
    const fakeUser = makeFakeUser();
    t.mock.method(userRepository, 'findById', async () => fakeUser);
    const token = signAuthToken(fakeUser);

    const { res, body } = await getMe({ Authorization: `Bearer ${token}` });
    const raw = JSON.stringify(body);

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.user.email, fakeUser.email);
    assert.equal(body.data.user.id, fakeUser._id);
    assert.equal(body.data.user.passwordHash, undefined);
    assert.ok(!raw.includes('passwordHash'));
  });

  test('rejects a request with no Authorization header', async () => {
    const { res, body } = await getMe({});
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });

  test('rejects a malformed Authorization header', async () => {
    const { res, body } = await getMe({ Authorization: 'NotBearer sometoken' });
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });

  test('rejects an invalid/garbage token', async () => {
    const { res, body } = await getMe({ Authorization: 'Bearer not-a-real-jwt' });
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'INVALID_TOKEN');
  });

  test('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'user' }, 'not-the-real-secret');
    const { res, body } = await getMe({ Authorization: `Bearer ${forged}` });
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'INVALID_TOKEN');
  });

  test('rejects an expired token', async () => {
    const expired = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'user' }, env.jwtSecret, { expiresIn: -10 });
    const { res, body } = await getMe({ Authorization: `Bearer ${expired}` });
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'TOKEN_EXPIRED');
  });

  test('rejects a token for a user that no longer exists', async (t) => {
    t.mock.method(userRepository, 'findById', async () => null);
    const token = signAuthToken(makeFakeUser());

    const { res, body } = await getMe({ Authorization: `Bearer ${token}` });
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'INVALID_TOKEN');
  });

  test('rejects a token for a suspended user', async (t) => {
    const suspendedUser = makeFakeUser({ status: 'suspended' });
    t.mock.method(userRepository, 'findById', async () => suspendedUser);
    const token = signAuthToken(suspendedUser);

    const { res, body } = await getMe({ Authorization: `Bearer ${token}` });
    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'ACCOUNT_SUSPENDED');
  });
});
