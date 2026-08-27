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
  await disconnectRedis();
});

describe('GET /health', () => {
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

    assert.equal(body.database, 'disconnected');
    assert.equal(body.redis, 'disconnected');
    assert.equal(body.queue, 'unavailable');
    assert.equal(body.status, 'degraded');
    assert.equal(res.status, 503);
  });

  test('reports queue: "ready" / redis: "connected" when the queue health check succeeds', async (t) => {
    t.mock.method(eventQueueService, 'checkHealth', async () => 'ready');
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    assert.equal(body.redis, 'connected');
    assert.equal(body.queue, 'ready');
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
    t.mock.method(eventQueueService, 'checkHealth', async () => 'unavailable');
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
    t.mock.method(eventQueueService, 'checkHealth', async () => 'unavailable');
    const res = await fetch(`${baseUrl}/health`);
    assert.ok(res.headers.get('x-content-type-options'));
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});
