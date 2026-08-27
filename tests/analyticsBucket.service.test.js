import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getBucket } from '../src/services/analytics/analyticsBucket.service.js';


describe('getBucket — hour granularity', () => {
  test('truncates to the start of the UTC hour', () => {
    const input = new Date('2026-08-20T15:47:33.219Z');
    const bucket = getBucket(input, 'hour');
    assert.equal(bucket.toISOString(), '2026-08-20T15:00:00.000Z');
  });

  test('an event exactly on the hour boundary maps to itself', () => {
    const input = new Date('2026-08-20T15:00:00.000Z');
    assert.equal(getBucket(input, 'hour').toISOString(), '2026-08-20T15:00:00.000Z');
  });

  test('an event one millisecond before the hour boundary stays in the PREVIOUS hour', () => {
    const input = new Date('2026-08-20T14:59:59.999Z');
    assert.equal(getBucket(input, 'hour').toISOString(), '2026-08-20T14:00:00.000Z');
  });
});

describe('getBucket — day granularity', () => {
  test('truncates to the start of the UTC day', () => {
    const input = new Date('2026-08-20T15:47:33.219Z');
    assert.equal(getBucket(input, 'day').toISOString(), '2026-08-20T00:00:00.000Z');
  });

  test('a day bucket is stable across every hour of that UTC day', () => {
    const earliest = getBucket(new Date('2026-08-20T00:00:00.000Z'), 'day');
    const latest = getBucket(new Date('2026-08-20T23:59:59.999Z'), 'day');
    assert.equal(earliest.toISOString(), latest.toISOString());
  });

  test('crossing UTC midnight moves to the next day bucket, regardless of local timezone', () => {
    const beforeMidnight = getBucket(new Date('2026-08-20T23:59:59.999Z'), 'day');
    const afterMidnight = getBucket(new Date('2026-08-21T00:00:00.000Z'), 'day');
    assert.notEqual(beforeMidnight.toISOString(), afterMidnight.toISOString());
    assert.equal(afterMidnight.toISOString(), '2026-08-21T00:00:00.000Z');
  });
});

describe('getBucket — late events (§31)', () => {
  test('an event timestamped in the past buckets by that timestamp, not by "now"', () => {
    const oldTimestamp = new Date('2020-01-01T05:30:00.000Z');
    const bucket = getBucket(oldTimestamp, 'hour');
    assert.equal(bucket.toISOString(), '2020-01-01T05:00:00.000Z');
    assert.notEqual(bucket.getUTCFullYear(), new Date().getUTCFullYear());
  });

  test('two events with different receivedAt but the same event timestamp land in the same bucket', () => {
    const eventTimestamp = new Date('2026-08-20T14:58:00.000Z');
    const bucketA = getBucket(eventTimestamp, 'hour');
    const bucketB = getBucket(eventTimestamp, 'hour');
    assert.equal(bucketA.toISOString(), bucketB.toISOString());
    assert.equal(bucketA.toISOString(), '2026-08-20T14:00:00.000Z');
  });
});

describe('getBucket — invalid input', () => {
  test('an unsupported granularity throws rather than silently producing a wrong bucket', () => {
    assert.throws(() => getBucket(new Date(), 'week'), /Unsupported analytics granularity/);
  });
});
