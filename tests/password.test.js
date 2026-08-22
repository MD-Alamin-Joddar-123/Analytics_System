import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

describe('password utility', () => {
  test('hashes a password and verifies it correctly', async () => {
    const hash = await hashPassword('CorrectHorseBattery1');
    assert.notEqual(hash, 'CorrectHorseBattery1');
    assert.ok(await verifyPassword('CorrectHorseBattery1', hash));
  });

  test('rejects an incorrect password against a hash', async () => {
    const hash = await hashPassword('CorrectHorseBattery1');
    assert.equal(await verifyPassword('WrongPassword1', hash), false);
  });

  test('hashing the same password twice produces different hashes (salted)', async () => {
    const [a, b] = await Promise.all([hashPassword('SamePassword1'), hashPassword('SamePassword1')]);
    assert.notEqual(a, b);
  });
});
