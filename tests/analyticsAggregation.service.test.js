import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsAggregationService } from '../src/services/analytics/analyticsAggregation.service.js';
import { analyticsRepository } from '../src/repositories/analytics/analytics.repository.js';
import { mockAnalyticsRepositories } from './helpers/mockAnalyticsRepositories.js';

let idCounter = 0;
function nextEventId() {
  idCounter += 1;
  return `evt-${idCounter}`;
}

function makeEvent(overrides = {}) {
  return {
    websiteId: 'w1',
    eventId: nextEventId(),
    eventName: 'page_view',
    timestamp: new Date('2026-08-20T15:30:00.000Z'),
    anonymousId: undefined,
    sessionId: undefined,
    data: undefined,
    ...overrides,
  };
}

function emptyCommerce(overrides = {}) {
  return {
    product: null,
    externalProductId: null,
    cart: null,
    isNewCart: false,
    cartItemChange: null,
    checkout: null,
    isNewCheckout: false,
    checkoutJustCompleted: false,
    order: null,
    isNewOrder: false,
    orderItems: [],
    ...overrides,
  };
}

function bucketKey(websiteId, granularity, isoBucket) {
  return `${websiteId}:${granularity}:${isoBucket}`;
}

describe('analyticsAggregationService.aggregateEvent — idempotency & retry safety (§24/§25)', () => {
  test('processing the same event twice only aggregates once', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const event = makeEvent({ eventId: 'evt-dup' });

    const first = await analyticsAggregationService.aggregateEvent(event, { commerce: emptyCommerce() });
    const second = await analyticsAggregationService.aggregateEvent(event, { commerce: emptyCommerce() });

    assert.equal(first.aggregated, true);
    assert.equal(second.aggregated, false);
    assert.equal(second.reason, 'already_claimed');

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.pageViews, 1);
  });

  test('a failed aggregation releases the idempotency claim so a retry re-attempts it', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const event = makeEvent({ eventId: 'evt-retry' });

    let callCount = 0;
    const localBuckets = new Map();
    t.mock.method(analyticsRepository, 'incrementBucket', async (websiteId, granularity, bucket, currency, inc) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('simulated transient write failure');
      }
      const key = `${websiteId}:${granularity}:${bucket.toISOString()}`;
      const doc = localBuckets.get(key) ?? { pageViews: 0 };
      doc.pageViews += inc.pageViews ?? 0;
      localBuckets.set(key, doc);
      return doc;
    });

    await assert.rejects(() => analyticsAggregationService.aggregateEvent(event, { commerce: emptyCommerce() }));
    assert.equal(analytics.processedEvents.has('w1:evt-retry'), false);
    assert.equal(analytics.releasedEvents.length, 1);

    const retryResult = await analyticsAggregationService.aggregateEvent(event, { commerce: emptyCommerce() });
    assert.equal(retryResult.aggregated, true);
    assert.equal(analytics.processedEvents.has('w1:evt-retry'), true);
    const bucket = localBuckets.get(`w1:hour:${new Date('2026-08-20T15:00:00.000Z').toISOString()}`);
    assert.equal(bucket.pageViews, 1);
  });

  test('an aggregation failure propagates the original error (never swallowed, §27)', async (t) => {
    mockAnalyticsRepositories(t);
    t.mock.method(analyticsRepository, 'incrementBucket', async () => {
      throw new Error('boom');
    });

    await assert.rejects(() => analyticsAggregationService.aggregateEvent(makeEvent(), { commerce: emptyCommerce() }), /boom/);
  });
});

describe('analyticsAggregationService.aggregateEvent — multi-tenant isolation (§4)', () => {
  test('two websites never share or influence each other\'s counters', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const bucketTs = new Date('2026-08-20T10:00:00.000Z');

    for (let i = 0; i < 3; i += 1) {
      await analyticsAggregationService.aggregateEvent(
        makeEvent({ websiteId: 'website-A', timestamp: bucketTs }),
        { commerce: emptyCommerce() }
      );
    }
    await analyticsAggregationService.aggregateEvent(
      makeEvent({
        websiteId: 'website-B',
        timestamp: bucketTs,
        eventName: 'purchase',
        data: { orderId: 'order-1' },
      }),
      {
        commerce: emptyCommerce({
          isNewOrder: true,
          order: { total: 10000, refundedAmount: 0, currency: 'USD' },
          orderItems: [],
        }),
      }
    );

    const bucketA = analytics.buckets.get(bucketKey('website-A', 'hour', bucketTs.toISOString()));
    const bucketB = analytics.buckets.get(bucketKey('website-B', 'hour', bucketTs.toISOString()));

    assert.equal(bucketA.pageViews, 3);
    assert.equal(bucketA.grossRevenueMinor, 0);
    assert.equal(bucketB.pageViews, 0);
    assert.equal(bucketB.grossRevenueMinor, 10000);
  });

  test('the same externalProductId under two different websites produces two independent ProductAnalyticsBucket documents', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const bucketTs = new Date('2026-08-20T10:00:00.000Z');
    const product = { externalProductId: 'shared-sku', name: 'Widget' };

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ websiteId: 'website-A', timestamp: bucketTs, eventName: 'product_view' }),
      { commerce: emptyCommerce({ product }) }
    );

    const productBucketA = analytics.productBuckets.get(
      `website-A:shared-sku:hour:${bucketTs.toISOString()}`
    );
    const productBucketB = analytics.productBuckets.get(
      `website-B:shared-sku:hour:${bucketTs.toISOString()}`
    );

    assert.equal(productBucketA.productViews, 1);
    assert.equal(productBucketB, undefined);
  });
});

describe('analyticsAggregationService.aggregateEvent — page metrics', () => {
  test('pageViews increments; both hour and day buckets are written for one event', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    await analyticsAggregationService.aggregateEvent(makeEvent({ timestamp: ts }), { commerce: emptyCommerce() });

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    const dayBucket = analytics.buckets.get(bucketKey('w1', 'day', '2026-08-20T00:00:00.000Z'));
    assert.equal(hourBucket.pageViews, 1);
    assert.equal(dayBucket.pageViews, 1);
  });

  test('uniqueVisitors counts one visitor once per bucket, even across multiple events', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, anonymousId: 'anon-1' }),
      { commerce: emptyCommerce() }
    );
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: new Date('2026-08-20T15:45:00.000Z'), anonymousId: 'anon-1' }),
      { commerce: emptyCommerce() }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.pageViews, 2);
    assert.equal(hourBucket.uniqueVisitors, 1);
  });

  test('the same visitor in a DIFFERENT hour bucket is counted again for that bucket, but not for the shared day bucket', async (t) => {
    const analytics = mockAnalyticsRepositories(t);

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: new Date('2026-08-20T09:00:00.000Z'), anonymousId: 'anon-1' }),
      { commerce: emptyCommerce() }
    );
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: new Date('2026-08-20T10:00:00.000Z'), anonymousId: 'anon-1' }),
      { commerce: emptyCommerce() }
    );

    const hour9 = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T09:00:00.000Z'));
    const hour10 = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T10:00:00.000Z'));
    const day = analytics.buckets.get(bucketKey('w1', 'day', '2026-08-20T00:00:00.000Z'));

    assert.equal(hour9.uniqueVisitors, 1);
    assert.equal(hour10.uniqueVisitors, 1);
    assert.equal(day.uniqueVisitors, 1);
  });

  test('uniqueSessions uses the resolved session\'s sessionId, falling back to the raw event.sessionId', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, sessionId: 'raw-session' }),
      { session: { sessionId: 'resolved-session' }, commerce: emptyCommerce() }
    );
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, sessionId: 'raw-session-2' }),
      { session: null, commerce: emptyCommerce() }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.uniqueSessions, 2);
  });

  test('an event with no anonymousId/sessionId still aggregates pageViews without touching visitor/session counters', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    await analyticsAggregationService.aggregateEvent(makeEvent(), { commerce: emptyCommerce() });
    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.pageViews, 1);
    assert.equal(hourBucket.uniqueVisitors, 0);
    assert.equal(hourBucket.uniqueSessions, 0);
  });
});

describe('analyticsAggregationService.aggregateEvent — product metrics', () => {
  test('product_view increments both the website-level and per-product productViews counters', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');
    const product = { externalProductId: 'p1', name: 'Widget', currency: 'USD' };

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'product_view' }),
      { commerce: emptyCommerce({ product }) }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    const productBucket = analytics.productBuckets.get(`w1:p1:hour:${new Date('2026-08-20T15:00:00.000Z').toISOString()}`);
    assert.equal(hourBucket.productViews, 1);
    assert.equal(productBucket.productViews, 1);
    assert.equal(productBucket.productNameSnapshot, 'Widget');
  });

  test('remove_from_cart increments the per-product removeFromCarts counter even with no resolved Product', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'remove_from_cart' }),
      { commerce: emptyCommerce({ externalProductId: 'p1' }) }
    );

    const productBucket = analytics.productBuckets.get(`w1:p1:hour:${new Date('2026-08-20T15:00:00.000Z').toISOString()}`);
    assert.equal(productBucket.removeFromCarts, 1);
    assert.equal(productBucket.productNameSnapshot, undefined);
  });

  test('a later event refreshes the CURRENT bucket\'s productNameSnapshot, never a past bucket\'s (§28)', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const hour1 = new Date('2026-08-20T09:00:00.000Z');
    const hour2 = new Date('2026-08-20T10:00:00.000Z');

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: hour1, eventName: 'product_view' }),
      { commerce: emptyCommerce({ product: { externalProductId: 'p1', name: 'Old Name' } }) }
    );
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: hour2, eventName: 'product_view' }),
      { commerce: emptyCommerce({ product: { externalProductId: 'p1', name: 'New Name' } }) }
    );

    const bucket1 = analytics.productBuckets.get(`w1:p1:hour:${hour1.toISOString()}`);
    const bucket2 = analytics.productBuckets.get(`w1:p1:hour:${hour2.toISOString()}`);
    assert.equal(bucket1.productNameSnapshot, 'Old Name');
    assert.equal(bucket2.productNameSnapshot, 'New Name');
  });
});

describe('analyticsAggregationService.aggregateEvent — cart metrics (§17, no revenue contamination)', () => {
  test('add_to_cart populates cartsCreated/cartItems/cartQuantity/cartValueMinor, and cart value is NEVER written to a revenue field', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'add_to_cart' }),
      {
        commerce: emptyCommerce({
          isNewCart: true,
          cartItemChange: { quantity: 2, unitPriceMinor: 1000 },
        }),
      }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.cartsCreated, 1);
    assert.equal(hourBucket.cartItems, 1);
    assert.equal(hourBucket.cartQuantity, 2);
    assert.equal(hourBucket.cartValueMinor, 2000);
    assert.equal(hourBucket.grossRevenueMinor, 0);
    assert.equal(hourBucket.netRevenueMinor, 0);
  });

  test('cartValueMinor (pre-purchase activity) and grossRevenueMinor (actual purchases) remain independent counters even together in one bucket', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'add_to_cart' }),
      { commerce: emptyCommerce({ isNewCart: true, cartItemChange: { quantity: 1, unitPriceMinor: 9999 } }) }
    );
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'purchase' }),
      {
        commerce: emptyCommerce({
          isNewOrder: true,
          order: { total: 5000, refundedAmount: 0, currency: 'USD' },
          orderItems: [],
        }),
      }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.cartValueMinor, 9999);
    assert.equal(hourBucket.grossRevenueMinor, 5000);
    assert.notEqual(hourBucket.cartValueMinor, hourBucket.grossRevenueMinor);
  });
});

describe('analyticsAggregationService.aggregateEvent — checkout metrics & duplicate protection (§18)', () => {
  test('checkoutStarted increments once for a new checkout, and NOT again for a second event referencing the same checkoutId', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'checkout', eventId: 'evt-checkout-1' }),
      { commerce: emptyCommerce({ isNewCheckout: true }) }
    );
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'checkout', eventId: 'evt-checkout-2' }),
      { commerce: emptyCommerce({ isNewCheckout: false }) }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.checkoutStarted, 1);
  });

  test('checkoutCompleted increments exactly once even if two purchase events both reference the checkout (§18)', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'purchase', eventId: 'evt-purchase-1' }),
      {
        commerce: emptyCommerce({
          isNewOrder: true,
          order: { total: 1000, refundedAmount: 0 },
          orderItems: [],
          checkoutJustCompleted: true,
        }),
      }
    );
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'purchase', eventId: 'evt-purchase-2' }),
      {
        commerce: emptyCommerce({
          isNewOrder: false,
          order: { total: 1000, refundedAmount: 0 },
          orderItems: [],
          checkoutJustCompleted: false,
        }),
      }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.checkoutCompleted, 1);
    assert.equal(hourBucket.orders, 1);
  });
});

describe('analyticsAggregationService.aggregateEvent — order/revenue metrics & duplicate protection (§9/§13/§14)', () => {
  test('a duplicate purchase event for the same externalOrderId increases orders/units/revenue only once', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');
    const order = { total: 10000, refundedAmount: 0, currency: 'USD' };
    const orderItems = [{ externalProductId: 'p1', productName: 'Widget', quantity: 2, total: 10000 }];

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'purchase', eventId: 'evt-order-1' }),
      { commerce: emptyCommerce({ isNewOrder: true, order, orderItems }) }
    );
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'purchase', eventId: 'evt-order-2' }),
      { commerce: emptyCommerce({ isNewOrder: false, order, orderItems: [] }) }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.orders, 1);
    assert.equal(hourBucket.unitsSold, 2);
    assert.equal(hourBucket.grossRevenueMinor, 10000);

    const productBucket = analytics.productBuckets.get(`w1:p1:hour:${new Date('2026-08-20T15:00:00.000Z').toISOString()}`);
    assert.equal(productBucket.unitsSold, 2);
    assert.equal(productBucket.revenueMinor, 10000);
  });

  test('net revenue = gross - refunded, using integer minor units end-to-end', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: ts, eventName: 'purchase' }),
      {
        commerce: emptyCommerce({
          isNewOrder: true,
          order: { total: 15000, refundedAmount: 3000, currency: 'USD' },
          orderItems: [],
        }),
      }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.grossRevenueMinor, 15000);
    assert.equal(hourBucket.refundedAmountMinor, 3000);
    assert.equal(hourBucket.netRevenueMinor, 12000);
    assert.ok(Number.isInteger(hourBucket.netRevenueMinor));
  });
});

describe('analyticsAggregationService.aggregateEvent — currency snapshot (§29)', () => {
  test('prefers the normalized Order currency over the raw event currency', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ eventName: 'purchase', data: { currency: 'EUR' } }),
      {
        commerce: emptyCommerce({
          isNewOrder: true,
          order: { total: 100, refundedAmount: 0, currency: 'USD' },
          orderItems: [],
        }),
      }
    );
    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.currency, 'USD');
  });

  test('a page_view with no commerce data leaves currency unset (nothing monetary to contextualize)', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    await analyticsAggregationService.aggregateEvent(makeEvent(), { commerce: emptyCommerce() });
    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.currency, undefined);
  });
});

describe('analyticsAggregationService.aggregateEvent — late events (§31)', () => {
  test('an event processed long after it occurred still lands in the bucket matching its own timestamp', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const eventTimestamp = new Date('2020-03-14T14:58:00.000Z');
    await analyticsAggregationService.aggregateEvent(
      makeEvent({ timestamp: eventTimestamp }),
      { commerce: emptyCommerce() }
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2020-03-14T14:00:00.000Z'));
    assert.ok(hourBucket);
    assert.equal(hourBucket.pageViews, 1);
    const todayBucketKey = bucketKey('w1', 'hour', new Date().toISOString().slice(0, 13) + ':00:00.000Z');
    assert.equal(analytics.buckets.has(todayBucketKey), false);
  });
});

describe('analyticsAggregationService.aggregateEvent — concurrency (§22/§23)', () => {
  test('100 concurrent page_view events (distinct visitors) in the same bucket produce exactly 100, never 99 or 101', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    const events = Array.from({ length: 100 }, (_, i) =>
      makeEvent({ timestamp: ts, anonymousId: `anon-${i}` })
    );
    await Promise.all(events.map((event) => analyticsAggregationService.aggregateEvent(event, { commerce: emptyCommerce() })));

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.pageViews, 100);
    assert.equal(hourBucket.uniqueVisitors, 100);
  });

  test('100 concurrent page_view events from the SAME visitor count uniqueVisitors as exactly 1', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    const events = Array.from({ length: 100 }, () => makeEvent({ timestamp: ts, anonymousId: 'anon-shared' }));
    await Promise.all(events.map((event) => analyticsAggregationService.aggregateEvent(event, { commerce: emptyCommerce() })));

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.pageViews, 100);
    assert.equal(hourBucket.uniqueVisitors, 1);
  });

  test('concurrent add_to_cart events for the same product sum quantity/value correctly', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');
    const product = { externalProductId: 'p1', name: 'Widget' };

    const events = Array.from({ length: 50 }, () => makeEvent({ timestamp: ts, eventName: 'add_to_cart' }));
    await Promise.all(
      events.map((event) =>
        analyticsAggregationService.aggregateEvent(event, {
          commerce: emptyCommerce({ product, cartItemChange: { quantity: 1, unitPriceMinor: 100 } }),
        })
      )
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.addToCarts, 50);
    assert.equal(hourBucket.cartQuantity, 50);
    assert.equal(hourBucket.cartValueMinor, 5000);

    const productBucket = analytics.productBuckets.get(`w1:p1:hour:${new Date('2026-08-20T15:00:00.000Z').toISOString()}`);
    assert.equal(productBucket.addToCarts, 50);
  });

  test('concurrent purchases for distinct orders sum revenue correctly, with no cross-order interference', async (t) => {
    const analytics = mockAnalyticsRepositories(t);
    const ts = new Date('2026-08-20T15:30:00.000Z');

    const events = Array.from({ length: 20 }, (_, i) => makeEvent({ timestamp: ts, eventName: 'purchase', eventId: `order-evt-${i}` }));
    await Promise.all(
      events.map((event) =>
        analyticsAggregationService.aggregateEvent(event, {
          commerce: emptyCommerce({
            isNewOrder: true,
            order: { total: 1000, refundedAmount: 0, currency: 'USD' },
            orderItems: [{ externalProductId: 'p1', quantity: 1, total: 1000 }],
          }),
        })
      )
    );

    const hourBucket = analytics.buckets.get(bucketKey('w1', 'hour', '2026-08-20T15:00:00.000Z'));
    assert.equal(hourBucket.orders, 20);
    assert.equal(hourBucket.grossRevenueMinor, 20000);
    assert.equal(hourBucket.unitsSold, 20);
  });
});
