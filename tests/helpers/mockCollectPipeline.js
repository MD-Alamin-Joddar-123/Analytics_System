import { websiteRepository } from '../../src/repositories/website.repository.js';
import { eventRepository } from '../../src/repositories/event.repository.js';
import { visitorRepository } from '../../src/repositories/visitor.repository.js';
import { sessionRepository } from '../../src/repositories/session.repository.js';
import { eventQueueService } from '../../src/queues/event.queue.js';
import { makeFakeWebsite } from './fakeWebsite.js';
import { mockCommerceRepositories } from './mockCommerceRepositories.js';
import { mockAnalyticsRepositories } from './mockAnalyticsRepositories.js';

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// Mocks every repository the collector touches (website, event, visitor,
// session, plus the Phase 6 commerce repositories via
// mockCommerceRepositories) and the Phase 7 event queue, with realistic
// in-memory stores (including duplicate-key race simulation on create),
// so multi-request flows — "second event reuses the same visitor",
// "session timeout creates a new one", "ingest then process" — can be
// tested end-to-end through the real HTTP → validator → controller →
// service chain without live MongoDB or Redis. Returns handles to the
// underlying Maps for direct state inspection/manipulation (e.g.
// backdating lastActivityAt to simulate timeout, or driving the worker's
// processing logic directly against the same store).
export function setupMockPipeline(t, { websiteId = 'a1b2c3d4e5f60718', websiteStatus = 'active' } = {}) {
  const events = new Map(); // `${websiteId}:${eventId}` -> event doc
  const visitors = new Map(); // `${websiteId}:${anonymousId}` -> visitor doc
  const sessions = new Map(); // `${websiteId}:${sessionId}` -> session doc
  const enqueuedJobs = []; // { eventObjectId, websiteId, eventId } — every enqueue call, in order

  // Phase 6: product_view/add_to_cart/checkout/purchase events now also
  // touch the commerce repositories. Tests using this helper mostly don't
  // care about commerce state (they're testing visitor/session behavior),
  // so a lightweight pass-through is enough here — tests that DO need to
  // inspect commerce documents mock those repositories themselves with
  // real state after calling this (see the Phase 6 test files).
  mockCommerceRepositories(t);
  // Phase 8: real (in-memory) analytics repositories so postAndProcess-
  // driven tests exercise the actual aggregation path end-to-end rather
  // than hitting live MongoDB. Tests that care about aggregated values
  // inspect the returned `analytics` handle; tests that don't just get
  // correct pass-through behavior for free.
  const analytics = mockAnalyticsRepositories(t);

  t.mock.method(websiteRepository, 'findByWebsiteId', async (id) =>
    id === websiteId ? makeFakeWebsite({ websiteId, status: websiteStatus }) : null
  );

  t.mock.method(eventRepository, 'existsByWebsiteAndEventId', async (wId, eventId) =>
    events.has(`${wId}:${eventId}`)
  );
  t.mock.method(eventRepository, 'findByWebsiteAndEventId', async (wId, eventId) =>
    events.get(`${wId}:${eventId}`) ?? null
  );
  // Returns a shallow copy — real Mongoose findById() returns a fresh
  // document snapshot each call, not a live reference into whatever
  // in-memory store the driver happens to use. Without this, a later
  // mutation (markProcessingStarted, etc.) on the stored record would
  // retroactively change fields already read into a local variable by an
  // in-flight caller, which can't happen against a real database.
  t.mock.method(eventRepository, 'findById', async (id) => {
    const record = [...events.values()].find((e) => e._id === id);
    return record ? { ...record } : null;
  });
  t.mock.method(eventRepository, 'create', async (doc) => {
    const key = `${doc.websiteId}:${doc.eventId}`;
    if (events.has(key)) {
      const err = new Error('duplicate key');
      err.code = 11000;
      throw err;
    }
    const record = { ...doc, _id: nextId('event') };
    events.set(key, record);
    return record;
  });
  t.mock.method(eventRepository, 'markProcessingStarted', async (id) => {
    const record = [...events.values()].find((e) => e._id === id);
    if (!record) return null;
    record.processingStatus = 'processing';
    record.lastProcessingAttemptAt = new Date();
    record.processingAttempts = (record.processingAttempts ?? 0) + 1;
    return record;
  });
  t.mock.method(eventRepository, 'markProcessingCompleted', async (id, { visitorId, sessionObjectId } = {}) => {
    const record = [...events.values()].find((e) => e._id === id);
    if (!record) return null;
    record.processingStatus = 'completed';
    record.processedAt = new Date();
    if (visitorId !== undefined) record.visitorId = visitorId;
    if (sessionObjectId !== undefined) record.sessionObjectId = sessionObjectId;
    return record;
  });
  t.mock.method(eventRepository, 'markProcessingFailed', async (id, errorMessage) => {
    const record = [...events.values()].find((e) => e._id === id);
    if (!record) return null;
    record.processingStatus = 'failed';
    record.lastProcessingError = String(errorMessage ?? '').slice(0, 1000);
    return record;
  });

  // Default: enqueueing always "succeeds" without touching real
  // Redis/BullMQ. Tests that specifically exercise queue failure
  // (event.service.js's §21 behavior) re-mock this within the test itself
  // to reject.
  t.mock.method(eventQueueService, 'enqueueEventProcessing', async (job) => {
    enqueuedJobs.push(job);
    return { id: `${job.websiteId}:${job.eventId}` };
  });

  t.mock.method(visitorRepository, 'findByWebsiteAndAnonymousId', async (wId, anonymousId) =>
    visitors.get(`${wId}:${anonymousId}`) ?? null
  );
  t.mock.method(visitorRepository, 'create', async (doc) => {
    const key = `${doc.websiteId}:${doc.anonymousId}`;
    if (visitors.has(key)) {
      const err = new Error('duplicate key');
      err.code = 11000;
      throw err;
    }
    const record = { ...doc, _id: nextId('visitor') };
    visitors.set(key, record);
    return record;
  });
  t.mock.method(visitorRepository, 'recordActivity', async (id, updates) => {
    const record = [...visitors.values()].find((v) => v._id === id);
    if (!record) return null;
    if (updates.lastSeenAt !== undefined) record.lastSeenAt = updates.lastSeenAt;
    if (updates.lastUrl !== undefined) record.lastUrl = updates.lastUrl;
    if (updates.lastReferrer !== undefined) record.lastReferrer = updates.lastReferrer;
    if (updates.lastSessionId !== undefined) record.lastSessionId = updates.lastSessionId;
    if (updates.firstSessionId !== undefined) record.firstSessionId = updates.firstSessionId;
    record.eventCount = (record.eventCount ?? 0) + 1;
    if (updates.incrementSessionCount) record.sessionCount = (record.sessionCount ?? 0) + 1;
    return record;
  });

  t.mock.method(sessionRepository, 'findByWebsiteAndSessionId', async (wId, sessionId) =>
    sessions.get(`${wId}:${sessionId}`) ?? null
  );
  t.mock.method(sessionRepository, 'create', async (doc) => {
    const key = `${doc.websiteId}:${doc.sessionId}`;
    if (sessions.has(key)) {
      const err = new Error('duplicate key');
      err.code = 11000;
      throw err;
    }
    const record = { ...doc, _id: nextId('session') };
    sessions.set(key, record);
    return record;
  });
  t.mock.method(sessionRepository, 'markEnded', async (id, endedAt) => {
    const record = [...sessions.values()].find((s) => s._id === id);
    if (record) record.endedAt = endedAt;
    return record ?? null;
  });
  t.mock.method(sessionRepository, 'recordActivity', async (id, updates) => {
    const record = [...sessions.values()].find((s) => s._id === id);
    if (!record) return null;
    record.lastActivityAt = updates.lastActivityAt;
    if (updates.exitPage !== undefined) record.exitPage = updates.exitPage;
    record.eventCount = (record.eventCount ?? 0) + 1;
    if (updates.incrementPageView) record.pageViewCount = (record.pageViewCount ?? 0) + 1;
    return record;
  });

  return { websiteId, events, visitors, sessions, enqueuedJobs, analytics };
}
