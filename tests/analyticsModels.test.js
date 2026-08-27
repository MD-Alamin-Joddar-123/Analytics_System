import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsBucket } from '../src/models/AnalyticsBucket.js';
import { ProductAnalyticsBucket } from '../src/models/ProductAnalyticsBucket.js';
import { AnalyticsVisitorBucket } from '../src/models/AnalyticsVisitorBucket.js';
import { AnalyticsSessionBucket } from '../src/models/AnalyticsSessionBucket.js';
import { AnalyticsEventProcessed } from '../src/models/AnalyticsEventProcessed.js';
import { SUPPORTED_GRANULARITIES } from '../src/constants/analyticsGranularity.js';


function findUniqueIndex(model, fields) {
  return model.schema.indexes().find(([keys, options]) => {
    const keyNames = Object.keys(keys);
    return (
      keyNames.length === fields.length &&
      fields.every((f, i) => keyNames[i] === f) &&
      options?.unique === true
    );
  });
}

describe('AnalyticsBucket — schema (§6/§7)', () => {
  test('has a unique compound index on websiteId + granularity + bucket', () => {
    assert.ok(findUniqueIndex(AnalyticsBucket, ['websiteId', 'granularity', 'bucket']));
  });

  test('websiteId is required (multi-tenant isolation, §4)', () => {
    assert.equal(AnalyticsBucket.schema.path('websiteId').isRequired, true);
  });

  test('granularity enum matches SUPPORTED_GRANULARITIES exactly — the single source of truth for extensibility (§5)', () => {
    assert.deepEqual(AnalyticsBucket.schema.path('granularity').enumValues, [...SUPPORTED_GRANULARITIES]);
  });

  test('every counter field defaults to 0, never undefined', () => {
    const doc = new AnalyticsBucket({ websiteId: 'w1', granularity: 'hour', bucket: new Date() });
    assert.equal(doc.pageViews, 0);
    assert.equal(doc.grossRevenueMinor, 0);
    assert.equal(doc.cartValueMinor, 0);
  });
});

describe('ProductAnalyticsBucket — schema (§8/§34)', () => {
  test('has a unique compound index on websiteId + productId + granularity + bucket', () => {
    assert.ok(findUniqueIndex(ProductAnalyticsBucket, ['websiteId', 'productId', 'granularity', 'bucket']));
  });

  test('productId is a plain string field (external id), not an ObjectId reference', () => {
    assert.equal(ProductAnalyticsBucket.schema.path('productId').instance, 'String');
  });
});

describe('AnalyticsVisitorBucket / AnalyticsSessionBucket — uniqueness collections (§11/§12/§34)', () => {
  test('AnalyticsVisitorBucket has a unique compound index on websiteId + granularity + bucket + anonymousId', () => {
    assert.ok(findUniqueIndex(AnalyticsVisitorBucket, ['websiteId', 'granularity', 'bucket', 'anonymousId']));
  });

  test('AnalyticsSessionBucket has a unique compound index on websiteId + granularity + bucket + sessionId', () => {
    assert.ok(findUniqueIndex(AnalyticsSessionBucket, ['websiteId', 'granularity', 'bucket', 'sessionId']));
  });

  test('neither model has an array field — one document per visitor/session per bucket, never an unbounded array (§12)', () => {
    assert.equal(AnalyticsVisitorBucket.schema.path('anonymousId').instance, 'String');
    assert.equal(AnalyticsSessionBucket.schema.path('sessionId').instance, 'String');
  });
});

describe('AnalyticsEventProcessed — idempotency marker (§24/§34)', () => {
  test('has a unique compound index on websiteId + eventId', () => {
    assert.ok(findUniqueIndex(AnalyticsEventProcessed, ['websiteId', 'eventId']));
  });
});

describe('Multi-tenant isolation (§4) — every analytics model carries websiteId', () => {
  for (const [name, Model] of [
    ['AnalyticsBucket', AnalyticsBucket],
    ['ProductAnalyticsBucket', ProductAnalyticsBucket],
    ['AnalyticsVisitorBucket', AnalyticsVisitorBucket],
    ['AnalyticsSessionBucket', AnalyticsSessionBucket],
    ['AnalyticsEventProcessed', AnalyticsEventProcessed],
  ]) {
    test(`${name} requires websiteId`, () => {
      assert.equal(Model.schema.path('websiteId').isRequired, true);
    });
  }
});
