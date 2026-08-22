import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { websiteRepository } from '../src/repositories/website.repository.js';
import { eventRepository } from '../src/repositories/event.repository.js';
import { eventQueueService } from '../src/queues/event.queue.js';
import { makeFakeWebsite } from './helpers/fakeWebsite.js';

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

function post(body) {
  return fetch(`${baseUrl}/api/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/collect — idempotency (websiteId + eventId)', () => {
  test('the same eventId is accepted once; a repeat does not create another document', async (t) => {
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      makeFakeWebsite({ websiteId: id, status: 'active' })
    );

    const store = new Map(); // simulates the unique (websiteId, eventId) index
    let createCallCount = 0;
    const enqueuedJobs = [];
    t.mock.method(eventRepository, 'findByWebsiteAndEventId', async (websiteId, eventId) =>
      store.get(`${websiteId}:${eventId}`) ?? null
    );
    t.mock.method(eventRepository, 'create', async (doc) => {
      createCallCount += 1;
      const record = { ...doc, _id: 'x', processingStatus: 'pending' };
      store.set(`${doc.websiteId}:${doc.eventId}`, record);
      return record;
    });
    t.mock.method(eventQueueService, 'enqueueEventProcessing', async (job) => {
      enqueuedJobs.push(job);
      return { id: `${job.websiteId}:${job.eventId}` };
    });

    const payload = { websiteId: WEBSITE_A, event: 'page_view', eventId: 'evt-fixed-123' };

    const first = await post(payload);
    const firstBody = await first.json();
    assert.equal(first.status, 202);
    assert.equal(firstBody.data.accepted, true);
    assert.equal(firstBody.data.duplicate, undefined);
    assert.equal(firstBody.data.eventId, 'evt-fixed-123');

    const second = await post(payload);
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondBody.data.accepted, true);
    assert.equal(secondBody.data.duplicate, true);
    assert.equal(secondBody.data.eventId, 'evt-fixed-123');

    assert.equal(createCallCount, 1); // no second document was created

    // Phase 7 §15/§16: the duplicate resubmission still attempts to
    // (re-)enqueue a processing job for the SAME event — a safe no-op at
    // the queue layer (deterministic jobId) if one is already queued, and
    // what makes a stranded pending/failed event recoverable via retry.
    assert.equal(enqueuedJobs.length, 2);
    assert.equal(enqueuedJobs[0].eventObjectId, 'x');
    assert.equal(enqueuedJobs[1].eventObjectId, 'x');
  });

  test('a race (duplicate key at insert time) is still treated as a safe idempotent success', async (t) => {
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      makeFakeWebsite({ websiteId: id, status: 'active' })
    );
    // Pre-check says "not seen yet" (lost the race), but the insert itself
    // hits the unique index — the second call (re-querying for the
    // winner) returns the document the concurrent request created.
    let lookupCalls = 0;
    t.mock.method(eventRepository, 'findByWebsiteAndEventId', async (websiteId, eventId) => {
      lookupCalls += 1;
      if (lookupCalls === 1) return null;
      return { _id: 'winner-id', websiteId, eventId, processingStatus: 'pending' };
    });
    t.mock.method(eventRepository, 'create', async () => {
      const err = new Error('E11000 duplicate key');
      err.code = 11000;
      throw err;
    });
    let enqueueCalls = 0;
    t.mock.method(eventQueueService, 'enqueueEventProcessing', async () => {
      enqueueCalls += 1;
      return { id: 'job-1' };
    });

    const res = await post({ websiteId: WEBSITE_A, event: 'page_view', eventId: 'evt-race-1' });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.accepted, true);
    assert.equal(body.data.duplicate, true);
    assert.equal(enqueueCalls, 1); // the winner's job still gets enqueued
  });

  test('the same eventId on two different websites is allowed (idempotency is per-website)', async (t) => {
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      makeFakeWebsite({ websiteId: id, status: 'active' })
    );

    const store = new Map();
    t.mock.method(eventRepository, 'findByWebsiteAndEventId', async (websiteId, eventId) =>
      store.get(`${websiteId}:${eventId}`) ?? null
    );
    t.mock.method(eventRepository, 'create', async (doc) => {
      const record = { ...doc, _id: 'x', processingStatus: 'pending' };
      store.set(`${doc.websiteId}:${doc.eventId}`, record);
      return record;
    });
    t.mock.method(eventQueueService, 'enqueueEventProcessing', async () => ({ id: 'job' }));

    const sharedEventId = 'evt-shared-across-sites';

    const resA = await post({ websiteId: WEBSITE_A, event: 'page_view', eventId: sharedEventId });
    const bodyA = await resA.json();
    const resB = await post({ websiteId: WEBSITE_B, event: 'page_view', eventId: sharedEventId });
    const bodyB = await resB.json();

    assert.equal(resA.status, 202);
    assert.equal(bodyA.data.duplicate, undefined);
    assert.equal(resB.status, 202);
    assert.equal(bodyB.data.duplicate, undefined);
  });

  test('queue submission failure for a brand-new event returns an error, not a false success (§21)', async (t) => {
    t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
      makeFakeWebsite({ websiteId: id, status: 'active' })
    );
    t.mock.method(eventRepository, 'findByWebsiteAndEventId', async () => null);
    t.mock.method(eventRepository, 'create', async (doc) => ({ ...doc, _id: 'x', processingStatus: 'pending' }));

    const { ApiError } = await import('../src/utils/ApiError.js');
    const { ErrorCodes } = await import('../src/constants/errorCodes.js');
    t.mock.method(eventQueueService, 'enqueueEventProcessing', async () => {
      throw ApiError.serviceUnavailable('Event was recorded but could not be queued for processing.', ErrorCodes.QUEUE_UNAVAILABLE);
    });

    const res = await post({ websiteId: WEBSITE_A, event: 'page_view', eventId: 'evt-queue-down' });
    const body = await res.json();

    assert.equal(res.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'QUEUE_UNAVAILABLE');
  });
});
