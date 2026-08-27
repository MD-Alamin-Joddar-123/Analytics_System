import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { verifyPassword } from '../src/utils/password.js';
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

describe('POST /api/auth/register', () => {
  test('registers a new user, hashes the password, and never returns it', async (t) => {
    t.mock.method(userRepository, 'findByEmail', async () => null);

    let capturedPasswordHash;
    t.mock.method(userRepository, 'create', async ({ name, email, passwordHash, role }) => {
      capturedPasswordHash = passwordHash;
      return makeFakeUser({ name, email, passwordHash, role });
    });

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jane Doe', email: 'Jane@Example.com', password: 'secure-password' }),
    });
    const body = await res.json();
    const raw = JSON.stringify(body);

    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.user.email, 'jane@example.com');
    assert.equal(body.data.user.name, 'Jane Doe');
    assert.equal(typeof body.data.token, 'string');
    assert.equal(body.data.token.split('.').length, 3);

    assert.equal(body.data.user.passwordHash, undefined);
    assert.ok(!raw.includes('passwordHash'));

    assert.notEqual(capturedPasswordHash, 'secure-password');
    assert.ok(await verifyPassword('secure-password', capturedPasswordHash));
  });

  test('rejects a missing name', async (t) => {
    t.mock.method(userRepository, 'findByEmail', async () => null);

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-name@example.com', password: 'secure-password' }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects an invalid email', async (t) => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Email', email: 'not-an-email', password: 'secure-password' }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects a password shorter than the minimum length', async (t) => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Weak Pw', email: 'weak@example.com', password: 'short' }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects a duplicate email with a clean 409, without leaking DB details', async (t) => {
    t.mock.method(userRepository, 'findByEmail', async () => makeFakeUser());

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dupe', email: 'john@example.com', password: 'secure-password' }),
    });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'EMAIL_ALREADY_EXISTS');
    assert.ok(!JSON.stringify(body).toLowerCase().includes('mongo'));
  });
});
