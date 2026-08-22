import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockPipeline } from './helpers/mockCollectPipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';
import { eventProcessingService } from '../src/services/event/eventProcessing.service.js';

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

function post(body) {
  return fetch(`${baseUrl}/api/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Concurrency', () => {
  // Phase 7: ingestion (POST /api/collect) no longer touches
  // Visitor/Session at all — that happens when the worker processes the
  // job. So the race that matters now is two concurrent processEvent()
  // calls, not two concurrent POSTs — these tests ingest both events
  // first (fast, independent), then process both jobs concurrently to
  // actually exercise the race in visitorService/sessionService.

  test('two near-simultaneous processing runs for the same new anonymousId create exactly one visitor', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors, events } = pipeline;

    const [resA, resB] = await Promise.all([
      post({ websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'race-anon', sessionId: 'race-sess-A' }),
      post({ websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'race-anon', sessionId: 'race-sess-B' }),
    ]);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);
    assert.equal(resA.status, 202);
    assert.equal(resB.status, 202);

    const docA = events.get(`${WEBSITE_ID}:${bodyA.data.eventId}`);
    const docB = events.get(`${WEBSITE_ID}:${bodyB.data.eventId}`);

    await Promise.all([
      eventProcessingService.processEvent(docA._id),
      eventProcessingService.processEvent(docB._id),
    ]);

    assert.equal(visitors.size, 1);
    assert.equal(visitors.get(`${WEBSITE_ID}:race-anon`).eventCount, 2);
  });

  test('two near-simultaneous processing runs for the same new sessionId create exactly one session', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { sessions, events } = pipeline;

    const [resA, resB] = await Promise.all([
      post({ websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1', sessionId: 'race-session' }),
      post({ websiteId: WEBSITE_ID, event: 'page_view', anonymousId: 'anon-1', sessionId: 'race-session' }),
    ]);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);
    assert.equal(resA.status, 202);
    assert.equal(resB.status, 202);

    const docA = events.get(`${WEBSITE_ID}:${bodyA.data.eventId}`);
    const docB = events.get(`${WEBSITE_ID}:${bodyB.data.eventId}`);

    await Promise.all([
      eventProcessingService.processEvent(docA._id),
      eventProcessingService.processEvent(docB._id),
    ]);

    assert.equal(sessions.size, 1);
    assert.equal(sessions.get(`${WEBSITE_ID}:race-session`).eventCount, 2);
  });
});

describe('Duplicate events do not double-count', () => {
  test('resubmitting the same eventId does not increment visitor/session counters again', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors, sessions } = pipeline;
    const payload = {
      websiteId: WEBSITE_ID,
      event: 'page_view',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      eventId: 'fixed-event-id',
    };

    const { res: firstRes, body: firstBody } = await postAndProcess(baseUrl, payload, pipeline);
    assert.equal(firstRes.status, 202);
    assert.equal(firstBody.data.duplicate, undefined);

    // The resubmission is ingestion-level duplicate handling (§15): no
    // second Event is created, but the existing job is re-enqueued —
    // "processing" it again just hits processEvent's own
    // already-completed guard (§11), a safe no-op.
    const { res: secondRes, body: secondBody, processingResult } = await postAndProcess(baseUrl, payload, pipeline);
    assert.equal(secondRes.status, 200);
    assert.equal(secondBody.data.duplicate, true);
    assert.equal(processingResult.reason, 'already_completed');

    const visitor = visitors.get(`${WEBSITE_ID}:anon-1`);
    const session = sessions.get(`${WEBSITE_ID}:sess-1`);
    assert.equal(visitor.eventCount, 1);
    assert.equal(session.eventCount, 1);
    assert.equal(session.pageViewCount, 1);
    assert.equal(visitors.size, 1);
    assert.equal(sessions.size, 1);
  });

  test('a duplicate event does not create a duplicate visitor or session even for a brand-new identity', async (t) => {
    // A duplicate whose visitor/session were never seen before (e.g. the
    // very first request for this identity already succeeded and this is
    // purely a network-level retry of the identical request). This tests
    // INGESTION alone — the point is that ingestion never touches
    // Visitor/Session regardless of the pre-existing event's identity, so
    // deliberately does not simulate the worker running afterward.
    const pipeline = setupMockPipeline(t);
    const { visitors, sessions, events } = pipeline;
    events.set(`${WEBSITE_ID}:already-seen`, {
      _id: 'preexisting-event',
      websiteId: WEBSITE_ID,
      eventId: 'already-seen',
      processingStatus: 'completed',
    });

    const res = await post({
      websiteId: WEBSITE_ID,
      event: 'page_view',
      anonymousId: 'never-resolved-anon',
      sessionId: 'never-resolved-sess',
      eventId: 'already-seen',
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.duplicate, true);
    // The duplicate short-circuits before touching visitor/session at all.
    assert.equal(visitors.size, 0);
    assert.equal(sessions.size, 0);
  });
});
