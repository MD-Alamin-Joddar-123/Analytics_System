import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { signAuthToken } from '../src/utils/jwt.js';
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

describe('POST /api/auth/logout', () => {
  test('logs out an authenticated user and follows the standard response envelope', async (t) => {
    const fakeUser = makeFakeUser();
    t.mock.method(userRepository, 'findById', async () => fakeUser);
    const token = signAuthToken(fakeUser);

    const res = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.data.message, 'string');
  });

  test('rejects logout without a valid token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    const body = await res.json();

    assert.equal(res.status, 401);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });
});
