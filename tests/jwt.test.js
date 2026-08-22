import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signAuthToken, verifyAuthToken } from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';

describe('jwt utility', () => {
  test('signs a token containing only sub and role', () => {
    const token = signAuthToken({ _id: 'abc123', role: 'admin', passwordHash: 'should-not-leak' });
    const decoded = jwt.decode(token);

    assert.equal(decoded.sub, 'abc123');
    assert.equal(decoded.role, 'admin');
    assert.equal(decoded.passwordHash, undefined);
    assert.equal(decoded.password, undefined);
  });

  test('verifyAuthToken round-trips a valid token', () => {
    const token = signAuthToken({ _id: 'user-1', role: 'user' });
    const decoded = verifyAuthToken(token);
    assert.equal(decoded.sub, 'user-1');
    assert.equal(decoded.role, 'user');
  });

  test('verifyAuthToken rejects a token signed with a different secret', () => {
    const tampered = jwt.sign({ sub: 'user-1', role: 'user' }, 'wrong-secret');
    assert.throws(() => verifyAuthToken(tampered));
  });

  test('verifyAuthToken rejects an expired token', () => {
    const expired = jwt.sign({ sub: 'user-1', role: 'user' }, env.jwtSecret, { expiresIn: -10 });
    assert.throws(() => verifyAuthToken(expired), /jwt expired/);
  });
});
