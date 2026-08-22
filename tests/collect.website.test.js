import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { eventRepository } from '../src/repositories/event.repository.js';
import { makeFakeWebsite } from './helpers/fakeWebsite.js';
import { mockEventQueueSuccess } from './helpers/mockEventQueue.js';

const WEBSITE_ID = 'a1b2c3d4e5f60718';

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

async function collect(status, t) {
  if (status === 'missing') {
    t.mock.method(websiteRepository, 'findByWebsiteId', async () => null);
  } else {
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      id === WEBSITE_ID ? makeFakeWebsite({ websiteId: WEBSITE_ID, status }) : null
    );
  }
  t.mock.method(eventRepository, 'findByWebsiteAndEventId', async () => null);
  t.mock.method(eventRepository, 'create', async (doc) => ({ ...doc, _id: 'x' }));
  mockEventQueueSuccess(t);

  const res = await fetch(`${baseUrl}/api/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ websiteId: WEBSITE_ID, event: 'page_view' }),
  });
  return { res, body: await res.json() };
}

describe('POST /api/collect — website status gating', () => {
  test('an active website accepts events', async (t) => {
    const { res, body } = await collect('active', t);
    assert.equal(res.status, 202);
    assert.equal(body.data.accepted, true);
  });

  test('a nonexistent website is rejected', async (t) => {
    const { res, body } = await collect('missing', t);
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'WEBSITE_NOT_FOUND');
  });

  test('an archived website is rejected', async (t) => {
    const { res, body } = await collect('archived', t);
    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'WEBSITE_ARCHIVED');
  });

  test('a paused website is rejected (documented policy: reject, not silently accept)', async (t) => {
    const { res, body } = await collect('paused', t);
    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'WEBSITE_PAUSED');
  });
});
