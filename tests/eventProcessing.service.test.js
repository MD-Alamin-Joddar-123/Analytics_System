import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eventProcessingService } from '../src/services/event/eventProcessing.service.js';
import { eventRepository } from '../src/repositories/event.repository.js';
import { visitorService } from '../src/services/visitor/visitor.service.js';
import { sessionService } from '../src/services/session/session.service.js';
import { productService } from '../src/services/product/product.service.js';
import { analyticsAggregationService } from '../src/services/analytics/analyticsAggregation.service.js';

const WEBSITE_ID = 'a1b2c3d4e5f60718';

function makeFakeEvent(overrides = {}) {
  const now = new Date();
  return {
    _id: 'event-1',
    websiteId: WEBSITE_ID,
    eventName: 'page_view',
    eventId: 'evt-1',
    timestamp: now,
    receivedAt: now,
    anonymousId: undefined,
    sessionId: undefined,
    data: undefined,
    processingStatus: 'pending',
    processingAttempts: 0,
    ...overrides,
  };
}

function mockEventStore(t, initial) {
  const store = new Map([[initial._id, { ...initial }]]);

  t.mock.method(eventRepository, 'findById', async (id) => {
    const doc = store.get(id);
    return doc ? { ...doc } : null;
  });
  t.mock.method(eventRepository, 'markProcessingStarted', async (id) => {
    const doc = store.get(id);
    if (!doc) return null;
    doc.processingStatus = 'processing';
    doc.processingAttempts = (doc.processingAttempts ?? 0) + 1;
    doc.lastProcessingAttemptAt = new Date();
    return { ...doc };
  });
  t.mock.method(eventRepository, 'markProcessingCompleted', async (id, { visitorId, sessionObjectId } = {}) => {
    const doc = store.get(id);
    if (!doc) return null;
    doc.processingStatus = 'completed';
    doc.processedAt = new Date();
    if (visitorId !== undefined) doc.visitorId = visitorId;
    if (sessionObjectId !== undefined) doc.sessionObjectId = sessionObjectId;
    return { ...doc };
  });
  t.mock.method(eventRepository, 'markProcessingFailed', async (id, errorMessage) => {
    const doc = store.get(id);
    if (!doc) return null;
    doc.processingStatus = 'failed';
    doc.lastProcessingError = String(errorMessage ?? '').slice(0, 1000);
    return { ...doc };
  });

  t.mock.method(analyticsAggregationService, 'aggregateEvent', async () => ({ aggregated: true }));

  return store;
}

describe('eventProcessingService.processEvent — worker core logic', () => {
  test('a missing Event is handled gracefully, not thrown', async (t) => {
    t.mock.method(eventRepository, 'findById', async () => null);

    const result = await eventProcessingService.processEvent('does-not-exist');

    assert.equal(result.processed, false);
    assert.equal(result.reason, 'event_not_found');
  });

  test('successful processing invokes visitor, session, and commerce resolution, then marks completed', async (t) => {
    const store = mockEventStore(t, makeFakeEvent({ anonymousId: 'anon-1', sessionId: 'sess-1' }));

    let visitorCalled = false;
    let sessionCalled = false;
    t.mock.method(visitorService, 'resolveVisitor', async () => {
      visitorCalled = true;
      return { visitor: { _id: 'visitor-1', anonymousId: 'anon-1' }, isNew: true };
    });
    t.mock.method(visitorService, 'recordVisitorActivity', async () => {});
    t.mock.method(sessionService, 'resolveSession', async () => {
      sessionCalled = true;
      return { session: { _id: 'session-1', sessionId: 'sess-1' }, isNew: true };
    });
    t.mock.method(sessionService, 'recordSessionActivity', async () => {});

    const result = await eventProcessingService.processEvent('event-1');

    assert.equal(result.processed, true);
    assert.equal(visitorCalled, true);
    assert.equal(sessionCalled, true);
    const finalDoc = store.get('event-1');
    assert.equal(finalDoc.processingStatus, 'completed');
    assert.equal(finalDoc.visitorId, 'visitor-1');
    assert.equal(finalDoc.sessionObjectId, 'session-1');
    assert.ok(finalDoc.processedAt);
  });

  test('commerce processing is invoked for a commerce-relevant event', async (t) => {
    mockEventStore(
      t,
      makeFakeEvent({
        eventName: 'product_view',
        data: { productId: 'p1', name: 'Widget', price: 10 },
      })
    );

    let resolveProductCalled = false;
    t.mock.method(productService, 'resolveProduct', async (websiteId, product) => {
      resolveProductCalled = true;
      assert.equal(product.externalProductId, 'p1');
      return { _id: 'product-1' };
    });

    const result = await eventProcessingService.processEvent('event-1');

    assert.equal(result.processed, true);
    assert.equal(resolveProductCalled, true);
  });

  test('analytics aggregation is invoked with the resolved visitor/session/commerce context, after commerce processing', async (t) => {
    mockEventStore(
      t,
      makeFakeEvent({
        eventName: 'product_view',
        anonymousId: 'anon-1',
        data: { productId: 'p1', name: 'Widget', price: 10 },
      })
    );
    t.mock.method(visitorService, 'resolveVisitor', async () => ({ visitor: { _id: 'visitor-1', anonymousId: 'anon-1' }, isNew: true }));
    t.mock.method(visitorService, 'recordVisitorActivity', async () => {});
    t.mock.method(sessionService, 'resolveSession', async () => ({ session: null, isNew: false }));
    t.mock.method(productService, 'resolveProduct', async () => ({ _id: 'product-1', externalProductId: 'p1', name: 'Widget' }));

    let aggregateCalledWith = null;
    t.mock.method(analyticsAggregationService, 'aggregateEvent', async (event, context) => {
      aggregateCalledWith = { event, context };
      return { aggregated: true };
    });

    const result = await eventProcessingService.processEvent('event-1');

    assert.equal(result.processed, true);
    assert.ok(aggregateCalledWith);
    assert.equal(aggregateCalledWith.event.eventName, 'product_view');
    assert.equal(aggregateCalledWith.context.visitor._id, 'visitor-1');
    assert.equal(aggregateCalledWith.context.commerce.product.externalProductId, 'p1');
  });

  test('§26/§27: an analytics aggregation failure propagates, marks the event failed, and does NOT mark it completed', async (t) => {
    const store = mockEventStore(t, makeFakeEvent({ anonymousId: 'anon-1' }));
    t.mock.method(visitorService, 'resolveVisitor', async () => ({ visitor: { _id: 'visitor-1' }, isNew: true }));
    t.mock.method(visitorService, 'recordVisitorActivity', async () => {});
    t.mock.method(sessionService, 'resolveSession', async () => ({ session: null, isNew: false }));
    t.mock.method(analyticsAggregationService, 'aggregateEvent', async () => {
      throw new Error('simulated analytics aggregation failure');
    });

    await assert.rejects(() => eventProcessingService.processEvent('event-1'), /simulated analytics aggregation failure/);

    const finalDoc = store.get('event-1');
    assert.equal(finalDoc.processingStatus, 'failed');
    assert.notEqual(finalDoc.processingStatus, 'completed');
    assert.equal(finalDoc.lastProcessingError, 'simulated analytics aggregation failure');
    assert.equal(finalDoc.processedAt, undefined);
  });

  test('an already-completed event is a safe no-op — visitor/session/commerce/analytics are never re-invoked', async (t) => {
    mockEventStore(t, makeFakeEvent({ processingStatus: 'completed', anonymousId: 'anon-1' }));

    let visitorCalled = false;
    t.mock.method(visitorService, 'resolveVisitor', async () => {
      visitorCalled = true;
      return { visitor: null, isNew: false };
    });
    let aggregateCalled = false;
    t.mock.method(analyticsAggregationService, 'aggregateEvent', async () => {
      aggregateCalled = true;
      return { aggregated: true };
    });

    const result = await eventProcessingService.processEvent('event-1');

    assert.equal(result.processed, false);
    assert.equal(result.reason, 'already_completed');
    assert.equal(visitorCalled, false);
    assert.equal(aggregateCalled, false);
  });
});

describe('eventProcessingService.processEvent — failure and retry', () => {
  test('a processing failure marks the event failed with the error message and increments attempts', async (t) => {
    const store = mockEventStore(t, makeFakeEvent({ anonymousId: 'anon-1' }));

    t.mock.method(visitorService, 'resolveVisitor', async () => {
      throw new Error('simulated database failure');
    });

    await assert.rejects(() => eventProcessingService.processEvent('event-1'), /simulated database failure/);

    const finalDoc = store.get('event-1');
    assert.equal(finalDoc.processingStatus, 'failed');
    assert.equal(finalDoc.lastProcessingError, 'simulated database failure');
    assert.equal(finalDoc.processingAttempts, 1);
  });

  test('re-processing a failed event (a BullMQ retry) tries again and increments the attempt counter further', async (t) => {
    const store = mockEventStore(t, makeFakeEvent({ anonymousId: 'anon-1' }));

    let callCount = 0;
    t.mock.method(visitorService, 'resolveVisitor', async () => {
      callCount += 1;
      if (callCount === 1) throw new Error('transient failure');
      return { visitor: { _id: 'visitor-1' }, isNew: true };
    });
    t.mock.method(visitorService, 'recordVisitorActivity', async () => {});
    t.mock.method(sessionService, 'resolveSession', async () => ({ session: null, isNew: false }));

    await assert.rejects(() => eventProcessingService.processEvent('event-1'));
    assert.equal(store.get('event-1').processingStatus, 'failed');
    assert.equal(store.get('event-1').processingAttempts, 1);

    const result = await eventProcessingService.processEvent('event-1');
    assert.equal(result.processed, true);
    assert.equal(store.get('event-1').processingStatus, 'completed');
    assert.equal(store.get('event-1').processingAttempts, 2);
  });

  test('the final state after all configured retries are exhausted is "failed", not silently discarded', async (t) => {
    const store = mockEventStore(t, makeFakeEvent({ anonymousId: 'anon-1', processingAttempts: 4 }));

    t.mock.method(visitorService, 'resolveVisitor', async () => {
      throw new Error('permanent failure');
    });

    await assert.rejects(() => eventProcessingService.processEvent('event-1'));

    const finalDoc = store.get('event-1');
    assert.equal(finalDoc.processingStatus, 'failed');
    assert.equal(finalDoc.lastProcessingError, 'permanent failure');
    assert.equal(finalDoc.processingAttempts, 5);
  });

  test('the stored error message is capped and never leaks a raw error object', async (t) => {
    const store = mockEventStore(t, makeFakeEvent({ anonymousId: 'anon-1' }));

    t.mock.method(visitorService, 'resolveVisitor', async () => {
      throw new Error('x'.repeat(2000));
    });

    await assert.rejects(() => eventProcessingService.processEvent('event-1'));

    const finalDoc = store.get('event-1');
    assert.equal(finalDoc.lastProcessingError.length, 1000);
    assert.equal(typeof finalDoc.lastProcessingError, 'string');
  });
});
