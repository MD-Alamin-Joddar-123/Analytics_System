import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKING_SCRIPT_PATH = path.join(__dirname, '..', 'public', 'tracking.js');

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

describe('GET /tracking.js (Phase 11)', () => {
  test('serves the built SDK with a JavaScript content type, when the build artifact exists', { skip: !fs.existsSync(TRACKING_SCRIPT_PATH) }, async () => {
    const res = await fetch(`${baseUrl}/tracking.js`);
    assert.equal(res.status, 200);
    const contentType = res.headers.get('content-type') ?? '';
    assert.ok(contentType.includes('javascript'));
    const body = await res.text();
    assert.ok(body.length > 0);
  });

  test('sets a permissive, credential-free CORS header (script tags don\'t need it, but crossorigin="anonymous" tags do)', { skip: !fs.existsSync(TRACKING_SCRIPT_PATH) }, async () => {
    const res = await fetch(`${baseUrl}/tracking.js`, { headers: { Origin: 'https://some-customer-site.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://some-customer-site.example');
  });

  test('never requires authentication — this is a public static asset, same as the collector', async () => {
    const res = await fetch(`${baseUrl}/tracking.js`);
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });

  test('does not exist under /api — it is a root-level static route, not a second collector endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/tracking.js`);
    assert.equal(res.status, 404);
  });
});

describe('GET /tracking.js — missing build artifact is a clean 404, never a 500 (regression guard)', () => {
  test('a nonexistent path under the same static-serving mechanism 404s cleanly via the standard error envelope', async () => {
    const res = await fetch(`${baseUrl}/this-route-does-not-exist.js`);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.ok(body.error?.code);
  });
});
