import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockPipeline } from './helpers/mockCollectPipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';

const WEBSITE_A = 'a1b2c3d4e5f60718';
const WEBSITE_B = 'bbbbccccddddeeee';

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

describe('Visitor resolution', () => {
  test('the first event for an anonymousId creates a visitor', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors } = pipeline;

    const { res } = await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'page_view',
      url: 'https://store.com/',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
    });

    assert.equal(res.status, 202);
    assert.equal(visitors.size, 1);
    const visitor = visitors.get(`${WEBSITE_A}:anon-1`);
    assert.equal(visitor.eventCount, 1);
    assert.equal(visitor.sessionCount, 1);
    assert.equal(visitor.firstSessionId, 'sess-1');
    assert.equal(visitor.lastSessionId, 'sess-1');
    assert.equal(visitor.firstUrl, 'https://store.com/');
  });

  test('a second event with the same anonymousId reuses the same visitor', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-1' });
    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'product_view',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      data: { productId: 'p1' },
    });

    assert.equal(visitors.size, 1);
    const visitor = visitors.get(`${WEBSITE_A}:anon-1`);
    assert.equal(visitor.eventCount, 2);
  });

  test('the same anonymousId on two different websites creates two different visitors', async (t) => {
    const pipeline = setupMockPipeline(t, { websiteId: WEBSITE_A });
    const { visitors } = pipeline;
    // Second pipeline setup would overwrite mocks; instead mock both
    // websites directly via a combined setup.
    const { websiteRepository } = await import('../src/repositories/website.repository.js');
    const { makeFakeWebsite } = await import('./helpers/fakeWebsite.js');
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      [WEBSITE_A, WEBSITE_B].includes(id) ? makeFakeWebsite({ websiteId: id, status: 'active' }) : null
    );

    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'shared-anon' });
    await post(pipeline, { websiteId: WEBSITE_B, event: 'page_view', anonymousId: 'shared-anon' });

    assert.equal(visitors.size, 2);
    assert.ok(visitors.has(`${WEBSITE_A}:shared-anon`));
    assert.ok(visitors.has(`${WEBSITE_B}:shared-anon`));
    assert.notEqual(visitors.get(`${WEBSITE_A}:shared-anon`)._id, visitors.get(`${WEBSITE_B}:shared-anon`)._id);
  });

  test('firstSeenAt/firstUrl/firstReferrer remain unchanged after later events; lastSeenAt/lastUrl update', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors } = pipeline;

    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'page_view',
      url: 'https://store.com/first',
      referrer: 'https://google.com',
      anonymousId: 'anon-1',
    });
    const firstSeenAt = visitors.get(`${WEBSITE_A}:anon-1`).firstSeenAt;

    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'page_view',
      url: 'https://store.com/second',
      referrer: 'https://facebook.com',
      anonymousId: 'anon-1',
    });

    const visitor = visitors.get(`${WEBSITE_A}:anon-1`);
    assert.equal(visitor.firstSeenAt, firstSeenAt);
    assert.equal(visitor.firstUrl, 'https://store.com/first');
    assert.equal(visitor.firstReferrer, 'https://google.com');
    assert.equal(visitor.lastUrl, 'https://store.com/second');
    assert.equal(visitor.lastReferrer, 'https://facebook.com');
  });

  test('lastSessionId updates when a new session starts, firstSessionId stays put', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-A' });
    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-B' });

    const visitor = visitors.get(`${WEBSITE_A}:anon-1`);
    assert.equal(visitor.firstSessionId, 'sess-A');
    assert.equal(visitor.lastSessionId, 'sess-B');
    assert.equal(visitor.sessionCount, 2);
  });
});

describe('Session resolution', () => {
  test('the first event with a sessionId creates a session', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { sessions } = pipeline;

    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'page_view',
      url: 'https://store.com/landing',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
    });

    assert.equal(sessions.size, 1);
    const session = sessions.get(`${WEBSITE_A}:sess-1`);
    assert.equal(session.eventCount, 1);
    assert.equal(session.pageViewCount, 1);
    assert.equal(session.landingPage, 'https://store.com/landing');
    assert.equal(session.exitPage, 'https://store.com/landing');
  });

  test('a subsequent event with the same sessionId reuses the session', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { sessions } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-1' });
    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'add_to_cart',
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      data: { productId: 'p1', price: 10, quantity: 1 },
    });

    assert.equal(sessions.size, 1);
    const session = sessions.get(`${WEBSITE_A}:sess-1`);
    assert.equal(session.eventCount, 2);
    assert.equal(session.pageViewCount, 1); // add_to_cart doesn't increment it
  });

  test('pageViewCount increments only for page_view; eventCount increments for every event', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { sessions } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'a', sessionId: 's' });
    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'a', sessionId: 's' });
    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'add_to_cart',
      anonymousId: 'a',
      sessionId: 's',
      data: { productId: 'p1', price: 1, quantity: 1 },
    });

    const session = sessions.get(`${WEBSITE_A}:s`);
    assert.equal(session.eventCount, 3);
    assert.equal(session.pageViewCount, 2);
  });

  test('exitPage updates on each page_view; a later non-page_view event does not change it', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { sessions } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', path: '/page-1', anonymousId: 'a', sessionId: 's' });
    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', path: '/page-2', anonymousId: 'a', sessionId: 's' });
    await post(pipeline, {
      websiteId: WEBSITE_A,
      event: 'add_to_cart',
      anonymousId: 'a',
      sessionId: 's',
      data: { productId: 'p1', price: 1, quantity: 1 },
    });

    const session = sessions.get(`${WEBSITE_A}:s`);
    assert.equal(session.landingPage, '/page-1');
    assert.equal(session.exitPage, '/page-2'); // unchanged by the trailing add_to_cart
  });

  test('a session belongs to the correct visitor', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors, sessions } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-1' });

    const visitor = visitors.get(`${WEBSITE_A}:anon-1`);
    const session = sessions.get(`${WEBSITE_A}:sess-1`);
    assert.equal(String(session.visitorId), String(visitor._id));
    assert.equal(session.anonymousId, 'anon-1');
  });

  test('the same sessionId on two different websites is isolated', async (t) => {
    const pipeline = setupMockPipeline(t, { websiteId: WEBSITE_A });
    const { sessions } = pipeline;
    const { websiteRepository } = await import('../src/repositories/website.repository.js');
    const { makeFakeWebsite } = await import('./helpers/fakeWebsite.js');
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      [WEBSITE_A, WEBSITE_B].includes(id) ? makeFakeWebsite({ websiteId: id, status: 'active' }) : null
    );

    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'anon-x', sessionId: 'shared-session' });
    await post(pipeline, { websiteId: WEBSITE_B, event: 'page_view', anonymousId: 'anon-y', sessionId: 'shared-session' });

    assert.equal(sessions.size, 2);
    assert.notEqual(
      sessions.get(`${WEBSITE_A}:shared-session`)._id,
      sessions.get(`${WEBSITE_B}:shared-session`)._id
    );
  });
});

describe('Event → visitor/session integration', () => {
  test('processing links visitorId and sessionObjectId onto the Event document', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { visitors, sessions, events } = pipeline;

    await post(pipeline, { websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'anon-1', sessionId: 'sess-1' });

    const visitor = visitors.get(`${WEBSITE_A}:anon-1`);
    const session = sessions.get(`${WEBSITE_A}:sess-1`);
    const eventDoc = [...events.values()][0];

    // raw client-supplied identifiers are preserved unmodified...
    assert.equal(eventDoc.anonymousId, 'anon-1');
    assert.equal(eventDoc.sessionId, 'sess-1');
    // ...and are absent at creation time, only appearing once processing
    // (the worker) resolves and links them — the defining Phase 7 change.
    assert.equal(String(eventDoc.visitorId), String(visitor._id));
    assert.equal(String(eventDoc.sessionObjectId), String(session._id));
    assert.equal(eventDoc.processingStatus, 'completed');
    assert.ok(eventDoc.processedAt);
  });

  test('visitorId/sessionObjectId are NOT set on the Event at ingestion time, before processing runs', async (t) => {
    const pipeline = setupMockPipeline(t);
    const { events } = pipeline;

    const res = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId: WEBSITE_A, event: 'page_view', anonymousId: 'anon-2', sessionId: 'sess-2' }),
    });
    assert.equal(res.status, 202);

    const eventDoc = events.get(`${WEBSITE_A}:${(await res.json()).data.eventId}`);
    assert.equal(eventDoc.processingStatus, 'pending');
    assert.equal(eventDoc.visitorId, undefined);
    assert.equal(eventDoc.sessionObjectId, undefined);
  });
});
