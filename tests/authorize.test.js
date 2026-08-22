import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requireRole } from '../src/middleware/authorize.js';

describe('requireRole', () => {
  test('calls next() with no error when the user has an allowed role', () => {
    const req = { user: { role: 'admin' } };
    let nextArg = 'not-called';

    requireRole('admin', 'user')(req, {}, (err) => {
      nextArg = err;
    });

    assert.equal(nextArg, undefined);
  });

  test('rejects with 403 FORBIDDEN when the role is not allowed', () => {
    const req = { user: { role: 'user' } };
    let nextArg;

    requireRole('admin')(req, {}, (err) => {
      nextArg = err;
    });

    assert.equal(nextArg.statusCode, 403);
    assert.equal(nextArg.code, 'FORBIDDEN');
  });

  test('rejects with 401 AUTH_REQUIRED when req.user is missing', () => {
    const req = {};
    let nextArg;

    requireRole('admin')(req, {}, (err) => {
      nextArg = err;
    });

    assert.equal(nextArg.statusCode, 401);
    assert.equal(nextArg.code, 'AUTH_REQUIRED');
  });
});
