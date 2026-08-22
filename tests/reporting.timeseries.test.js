import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockReportingPipeline } from './helpers/mockReportingPipeline.js';

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

function get(path, token) {
  return fetch(`${baseUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

describe('GET /api/reports/:websiteId/timeseries', () => {
  test('daily granularity returns one point per seeded day bucket, in ascending order', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({ granularity: 'day', bucket: new Date('2026-08-12T00:00:00.000Z'), pageViews: 30 });
    pipeline.seedBucket({ granularity: 'day', bucket: new Date('2026-08-10T00:00:00.000Z'), pageViews: 10 });
    pipeline.seedBucket({ granularity: 'day', bucket: new Date('2026-08-11T00:00:00.000Z'), pageViews: 20 });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/timeseries?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&granularity=day`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.granularity, 'day');
    assert.equal(body.data.points.length, 3);
    // Bucket ordering (§2/§19): ascending by date, matching seed order 10/11/12.
    assert.deepEqual(
      body.data.points.map((p) => p.pageViews),
      [10, 20, 30]
    );
    assert.equal(body.data.points[0].date, '2026-08-10T00:00:00.000Z');
  });

  test('hourly granularity returns hour-bucketed points, independent of the day buckets', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({ granularity: 'hour', bucket: new Date('2026-08-10T09:00:00.000Z'), pageViews: 5 });
    pipeline.seedBucket({ granularity: 'hour', bucket: new Date('2026-08-10T10:00:00.000Z'), pageViews: 7 });
    pipeline.seedBucket({ granularity: 'day', bucket: new Date('2026-08-10T00:00:00.000Z'), pageViews: 999 }); // must not leak in

    const res = await get(
      `/api/reports/${pipeline.websiteId}/timeseries?from=2026-08-10T00:00:00.000Z&to=2026-08-11T00:00:00.000Z&granularity=hour`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(body.data.points.length, 2);
    assert.deepEqual(
      body.data.points.map((p) => p.pageViews),
      [5, 7]
    );
  });

  test('each point includes revenue fields converted to major units', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({
      bucket: new Date('2026-08-10T00:00:00.000Z'),
      orders: 3,
      grossRevenueMinor: 15000,
      refundedAmountMinor: 1000,
      netRevenueMinor: 14000,
    });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/timeseries?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    const point = body.data.points[0];
    assert.equal(point.orders, 3);
    assert.equal(point.grossRevenue, 150);
    assert.equal(point.refundedAmount, 10);
    assert.equal(point.netRevenue, 140);
  });

  test('date filtering excludes buckets outside the requested window', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    pipeline.seedBucket({ bucket: new Date('2026-08-10T00:00:00.000Z'), pageViews: 1 });
    pipeline.seedBucket({ bucket: new Date('2026-09-10T00:00:00.000Z'), pageViews: 2 });

    const res = await get(
      `/api/reports/${pipeline.websiteId}/timeseries?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(body.data.points.length, 1);
    assert.equal(body.data.points[0].pageViews, 1);
  });

  test('an unsupported granularity is rejected (§8/§13)', async (t) => {
    const pipeline = setupMockReportingPipeline(t);

    const res = await get(
      `/api/reports/${pipeline.websiteId}/timeseries?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&granularity=week`,
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_GRANULARITY');
  });
});
