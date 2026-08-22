import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateWebsiteId } from '../src/utils/websiteId.js';

describe('generateWebsiteId', () => {
  test('produces a 16-character lowercase hex id that does not resemble a MongoDB ObjectId', () => {
    const id = generateWebsiteId();
    assert.match(id, /^[a-f0-9]{16}$/);
    // MongoDB ObjectIds are 24 hex characters — assert we're not accidentally
    // that length/shape, keeping the public id clearly distinct.
    assert.notEqual(id.length, 24);
  });

  test('generates different ids on repeated calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateWebsiteId()));
    assert.equal(ids.size, 20);
  });
});
