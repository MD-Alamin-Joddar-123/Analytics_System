import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { eventQueueService } from '../src/queues/event.queue.js';
import { disconnectRedis } from '../src/config/redis.js';

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // The unmocked health checks above construct a real (lazily-connecting)
  // Redis client that keeps retrying indefinitely by design (correct for
  // a long-running server — see config/redis.js — but it would otherwise
  // keep this test file's process alive forever, since a genuinely
  // unreachable Redis never stops rescheduling reconnect timers on its
  // own). Explicitly tear it down so the process can exit normally.
  await disconnectRedis();
});

describe('GET /health', () => {
  // These two hit the REAL (unmocked) Redis/queue health check — bounded
  // by config/redis.js's 2s timeout, so still fast, and a genuine
  // end-to-end confirmation that the endpoint doesn't hang when Redis is
  // truly unavailable (this sandbox's actual condition).
  test('returns a well-formed health payload', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.ok(['healthy', 'degraded'].includes(body.status));
    assert.ok(['connected', 'connecting', 'disconnected', 'disconnecting'].includes(body.database));
    assert.ok(['connected', 'disconnected'].includes(body.redis));
    assert.ok(['ready', 'unavailable'].includes(body.queue));
    assert.equal(typeof body.uptime, 'number');
    assert.equal(typeof body.timestamp, 'string');
    assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  });

  test('reports degraded (503) when the database and Redis are not connected', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    // In this test process we never call connectDatabase() or have a real
    // Redis available, so both must be reported as not connected.
    assert.equal(body.database, 'disconnected');
    assert.equal(body.redis, 'disconnected');
    assert.equal(body.queue, 'unavailable');
    assert.equal(body.status, 'degraded');
    assert.equal(res.status, 503);
  });

  // The remaining status-combination tests mock eventQueueService.checkHealth
  // directly — fast and deterministic, and exercises the controller's own
  // status-combining logic independent of what's actually reachable in this
  // environment.
  test('reports queue: "ready" / redis: "connected" when the queue health check succeeds', async (t) => {
    t.mock.method(eventQueueService, 'checkHealth', async () => 'ready');
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    assert.equal(body.redis, 'connected');
    assert.equal(body.queue, 'ready');
    // Overall status still degraded because the database is disconnected
    // in this test process — status only becomes "healthy" when EVERY
    // dependency is up.
    assert.equal(body.status, 'degraded');
    assert.equal(res.status, 503);
  });

  test('reports queue: "unavailable" / redis: "disconnected" when the queue health check fails', async (t) => {
    t.mock.method(eventQueueService, 'checkHealth', async () => 'unavailable');
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    assert.equal(body.redis, 'disconnected');
    assert.equal(body.queue, 'unavailable');
    assert.equal(body.status, 'degraded');
  });

  test('never exposes internal Redis URL/credentials in the response', async (t) => {
    t.mock.method(eventQueueService, 'checkHealth', async () => 'ready');
    const res = await fetch(`${baseUrl}/health`);
    const raw = JSON.stringify(await res.json());

    assert.ok(!raw.includes('redis://'));
    assert.ok(!raw.toLowerCase().includes('password'));
  });
});

describe('404 handling', () => {
  test('unknown routes return a consistent error envelope', async () => {
    const res = await fetch(`${baseUrl}/this-route-does-not-exist`);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(typeof body.message, 'string');
  });
});

describe('CORS configuration', () => {
  test('allows a whitelisted origin', async (t) => {
    t.mock.method(eventQueueService, 'checkHealth', async () => 'unavailable'); // headers-only test, speed up by skipping the real bounded wait
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  });

  test('rejects a non-whitelisted origin at preflight', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.notEqual(res.headers.get('access-control-allow-origin'), 'http://evil.example.com');
  });
});

describe('security headers', () => {
  test('helmet headers are present', async (t) => {
    t.mock.method(eventQueueService, 'checkHealth', async () => 'unavailable'); // headers-only test, speed up by skipping the real bounded wait
    const res = await fetch(`${baseUrl}/health`);
    assert.ok(res.headers.get('x-content-type-options'));
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});
