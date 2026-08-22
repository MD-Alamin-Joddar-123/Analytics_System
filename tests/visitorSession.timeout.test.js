import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { setupMockPipeline } from './helpers/mockCollectPipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';

const WEBSITE_ID = 'a1b2c3d4e5f60718';
const TIMEOUT_MS = env.sessionTimeoutMinutes * 60 * 1000;

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

describe('Session inactivity timeout', () => {
  test('an event within the timeout window continues the same session', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { sessions } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-1' });
    const original = sessions.get(`${WEBSITE_ID}:sess-1`);

    // Backdate lastActivityAt to just inside the window (timeout - 1 minute).
    original.lastActivityAt = new Date(Date.now() - TIMEOUT_MS + 60_000);

    await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-1' });

    assert.equal(sessions.size, 1);
    assert.equal(sessions.get(`${WEBSITE_ID}:sess-1`).eventCount, 2);
  });

  test('an event after the timeout window starts a new session, and ends the old one', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { sessions, visitors } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-1' });
    const original = sessions.get(`${WEBSITE_ID}:sess-1`);
    const originalLastActivity = new Date(Date.now() - TIMEOUT_MS - 60_000); // 1 minute past expiry
    original.lastActivityAt = originalLastActivity;

    await post(pipeline, { websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-1' });

    // The original session is marked ended and untouched otherwise.
    assert.equal(original.endedAt.getTime(), originalLastActivity.getTime());
    assert.equal(original.eventCount, 1);

    // A second, distinct session document now exists for the same visitor,
    // under a different (server-generated) sessionId — the string
    // "sess-1" is permanently tied to the ended session.
    assert.equal(sessions.size, 2);
    const newSession = [...sessions.values()].find((s) => s !== original);
    assert.notEqual(newSession.sessionId, 'sess-1');
    assert.equal(newSession.eventCount, 1);
    assert.equal(String(newSession.visitorId), String(original.visitorId));

    // The visitor's sessionCount reflects two genuinely distinct sessions.
    const visitor = visitors.get(`${WEBSITE_ID}:anon-1`);
    assert.equal(visitor.sessionCount, 2);
    assert.equal(visitor.lastSessionId, newSession.sessionId);
    assert.equal(visitor.firstSessionId, 'sess-1');
  });

  test('SESSION_TIMEOUT_MINUTES is configurable, not hard-coded (env-driven)', () => {
    assert.equal(typeof env.sessionTimeoutMinutes, 'number');
    assert.ok(env.sessionTimeoutMinutes > 0);
  });
});
