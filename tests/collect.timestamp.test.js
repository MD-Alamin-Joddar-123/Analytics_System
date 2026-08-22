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

async function collect(body, t) {
  t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
    id === WEBSITE_ID ? makeFakeWebsite({ websiteId: WEBSITE_ID, status: 'active' }) : null
  );
  t.mock.method(eventRepository, 'findByWebsiteAndEventId', async () => null);
  let captured;
  t.mock.method(eventRepository, 'create', async (doc) => {
    captured = doc;
    return { ...doc, _id: 'x' };
  });
  mockEventQueueSuccess(t);

  const res = await fetch(`${baseUrl}/api/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: await res.json(), captured };
}

describe('POST /api/collect — timestamp handling', () => {
  test('preserves a valid client-supplied timestamp, distinct from receivedAt', async (t) => {
    const clientTime = '2026-01-01T00:00:00.000Z';
    const before2 = Date.now();
    const { res, captured } = await collect({ websiteId: WEBSITE_ID, event: 'page_view', timestamp: clientTime }, t);
    const after2 = Date.now();

    assert.equal(res.status, 202);
    assert.equal(captured.timestamp.toISOString(), clientTime);
    assert.ok(captured.receivedAt.getTime() >= before2 && captured.receivedAt.getTime() <= after2);
    assert.notEqual(captured.timestamp.getTime(), captured.receivedAt.getTime());
  });

  test('defaults timestamp to the server receive time when omitted', async (t) => {
    const { res, captured } = await collect({ websiteId: WEBSITE_ID, event: 'page_view' }, t);

    assert.equal(res.status, 202);
    assert.equal(captured.timestamp.getTime(), captured.receivedAt.getTime());
  });

  test('receivedAt always reflects server time, even with a client timestamp far in the past', async (t) => {
    const before2 = Date.now();
    const { captured } = await collect(
      { websiteId: WEBSITE_ID, event: 'page_view', timestamp: '2000-01-01T00:00:00.000Z' },
      t
    );
    const after2 = Date.now();

    assert.ok(captured.receivedAt.getTime() >= before2 && captured.receivedAt.getTime() <= after2);
  });

  test('rejects a timestamp too far in the future (clock-skew protection)', async (t) => {
    const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +1 day
    const { res, body } = await collect({ websiteId: WEBSITE_ID, event: 'page_view', timestamp: farFuture }, t);

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_TIMESTAMP');
  });

  test('allows a small amount of future clock skew (within tolerance)', async (t) => {
    const slightlyAhead = new Date(Date.now() + 60 * 1000).toISOString(); // +1 minute
    const { res } = await collect({ websiteId: WEBSITE_ID, event: 'page_view', timestamp: slightlyAhead }, t);

    assert.equal(res.status, 202);
  });
});
