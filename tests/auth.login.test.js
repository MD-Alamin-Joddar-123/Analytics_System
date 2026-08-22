import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { hashPassword } from '../src/utils/password.js';
import { verifyAuthToken } from '../src/utils/jwt.js';
import { makeFakeUser } from './helpers/fakeUser.js';

let server;
let baseUrl;
let correctHash;

before(async () => {
  correctHash = await hashPassword('CorrectPassword1');
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function login(body) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: await res.json() };
}

describe('POST /api/auth/login', () => {
  test('logs in with correct credentials and returns a JWT + safe user', async (t) => {
    t.mock.method(userRepository, 'findByEmail', async () => makeFakeUser({ passwordHash: correctHash }));
    t.mock.method(userRepository, 'updateLastLogin', async (id) =>
      makeFakeUser({ passwordHash: correctHash, lastLoginAt: new Date().toISOString() })
    );

    const { res, body } = await login({ email: 'john@example.com', password: 'CorrectPassword1' });

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.data.token, 'string');
    assert.equal(body.data.user.email, 'john@example.com');
    assert.equal(body.data.user.passwordHash, undefined);
    assert.ok(body.data.user.lastLoginAt);

    const decoded = verifyAuthToken(body.data.token);
    assert.equal(decoded.sub, '507f1f77bcf86cd799439011');
    assert.equal(decoded.role, 'user');
  });

  test('rejects an incorrect password with a generic message', async (t) => {
    t.mock.method(userRepository, 'findByEmail', async () => makeFakeUser({ passwordHash: correctHash }));

    const { res, body } = await login({ email: 'john@example.com', password: 'WrongPassword1' });

    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(body.message, 'Invalid email or password.');
  });

  test('rejects an unknown email with the same generic message (no user enumeration)', async (t) => {
    t.mock.method(userRepository, 'findByEmail', async () => null);

    const { res, body } = await login({ email: 'nobody@example.com', password: 'WhoKnows1' });

    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(body.message, 'Invalid email or password.');
  });

  test('rejects a login for a suspended account', async (t) => {
    t.mock.method(
      userRepository,
      'findByEmail',
      async () => makeFakeUser({ passwordHash: correctHash, status: 'suspended' })
    );

    const { res, body } = await login({ email: 'john@example.com', password: 'CorrectPassword1' });

    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'ACCOUNT_SUSPENDED');
  });

  test('rejects a malformed request body', async () => {
    const { res, body } = await login({ email: 'john@example.com' });

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });
});
