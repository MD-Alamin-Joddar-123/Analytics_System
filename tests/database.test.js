import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabaseState } from '../src/config/database.js';

describe('database config', () => {
  test('reports "disconnected" before any connection attempt', () => {
    assert.equal(getDatabaseState(), 'disconnected');
  });
});
