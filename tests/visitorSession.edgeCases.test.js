import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockPipeline } from './helpers/mockCollectPipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';

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

function post(pipeline, body) {
  return postAndProcess(baseUrl, body, pipeline);
}

describe('Missing identifiers', () => {
  test('a missing anonymousId is accepted as an unidentifiable event — no visitor/session created', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors, sessions } = pipeline;

    const { res, body } = await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', url: 'https://store.com/' });

    assert.equal(res.status, 202);
    assert.equal(body.data.accepted, true);
    assert.equal(visitors.size, 0);
    assert.equal(sessions.size, 0);
  });

  test('a sessionId with no anonymousId is also treated as unidentifiable — no session without an owning visitor', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors, sessions } = pipeline;

    const { res } = await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', sessionId: 'orphan-session' });

    assert.equal(res.status, 202);
    assert.equal(visitors.size, 0);
    assert.equal(sessions.size, 0);
  });

  test('anonymousId present but sessionId missing: a visitor is created, and a server-generated session backs the event', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors, sessions } = pipeline;

    const { res } = await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-no-session' });

    assert.equal(res.status, 202);
    assert.equal(visitors.size, 1);
    assert.equal(sessions.size, 1);
    const session = [...sessions.values()][0];
    // Server-generated — a UUID, not empty/undefined, and not exposing an
    // internal MongoDB id shape.
    assert.match(session.sessionId, /^[0-9a-f-]{36}$/);
  });

  test('two events with anonymousId but no sessionId each get their own session (documented behavior)', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { sessions } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-x' });
    await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-x' });

    // Without a client-persisted sessionId, the backend has no stable
    // input to correlate the two events into one session — this is the
    // documented, honest fallback (Phase 5 §21), not a bug.
    assert.equal(sessions.size, 2);
  });
});

describe('Website status gating still applies with the visitor/session pipeline', () => {
  test('an archived website is still rejected before any Event is created or visitor/session work happens', async (t) => {
    const pipeline = setupMockPipeline(t, { websiteStatus: 'archived' });
    const { visitors, sessions, events } = pipeline;

    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1' }),
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'WEBSITE_ARCHIVED');
    assert.equal(events.size, 0);
    assert.equal(visitors.size, 0);
    assert.equal(sessions.size, 0);
  });

  test('a paused website is still rejected before any Event is created or visitor/session work happens', async (t) => {
    const pipeline = setupMockPipeline(t, { websiteStatus: 'paused' });
    const { visitors, sessions, events } = pipeline;

    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1' }),
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'WEBSITE_PAUSED');
    assert.equal(events.size, 0);
    assert.equal(visitors.size, 0);
    assert.equal(sessions.size, 0);
  });
});

describe('Privacy', () => {
  test('no JWT/Authorization header is required for the collector', async (t) => {
    setupMockPipeline(t);
    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1' }),
    });
    assert.equal(res.status, 202);
  });

  test('the visitor and session documents never contain an IP address or fingerprint-style field', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors, sessions } = pipeline;

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'page_view',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      language: 'en-US',
      screenWidth: 1920,
      screenHeight: 1080,
      timezone: 'Asia/Dhaka',
    });

    const visitor = visitors.get(`${WEBSITE_ID}:anon-1`);
    const session = sessions.get(`${WEBSITE_ID}:sess-1`);
    const forbiddenKeys = ['ip', 'ipAddress', 'fingerprint', 'email', 'phone', 'password'];

    for (const key of forbiddenKeys) {
      assert.equal(key in visitor, false, `visitor should not contain "${key}"`);
      assert.equal(key in session, false, `session should not contain "${key}"`);
    }
  });

  test('visitor identity is websiteId + anonymousId only — no other field is used to look it up', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors } = pipeline;

    await post(pipeline, {
      websiteId: WEBSITE_ID,
      event: 'page_view',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      userAgent: 'ignored-if-sent-in-body',
    });

    // Sending an anonymousId is what creates the visitor — nothing else
    // (userAgent header, etc.) is ever part of the lookup key.
    assert.equal(visitors.size, 1);
    assert.ok(visitors.has(`${WEBSITE_ID}:anon-1`));
  });
});
