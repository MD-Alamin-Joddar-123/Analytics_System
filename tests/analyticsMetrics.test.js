import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mapEventToBucketIncrements, mapEventToProductOperations } from '../src/constants/analyticsMetrics.js';

// Pure-function tests (Phase 8 §37/§43 EVENT MAPPING) — no I/O, no mocks,
// no database. These functions are the single source of truth for
// "what does this event mean for analytics counters" — see
// analyticsAggregation.service.js, the only caller.

describe('mapEventToBucketIncrements — website-level counters', () => {
  test('page_view increments pageViews only', () => {
    assert.deepEqual(mapEventToBucketIncrements('page_view', null), { pageViews: 1 });
  });

  test('product_view increments productViews only', () => {
    assert.deepEqual(mapEventToBucketIncrements('product_view', { product: { _id: 'p1' } }), { productViews: 1 });
  });

  test('add_to_cart without a resolved cart/product only increments addToCarts', () => {
    assert.deepEqual(mapEventToBucketIncrements('add_to_cart', { isNewCart: false, cartItemChange: null }), {
      addToCarts: 1,
    });
  });

  test('add_to_cart for a brand-new cart also increments cartsCreated', () => {
    const inc = mapEventToBucketIncrements('add_to_cart', { isNewCart: true, cartItemChange: null });
    assert.equal(inc.addToCarts, 1);
    assert.equal(inc.cartsCreated, 1);
  });

  test('add_to_cart with a cart item change increments cartItems/cartQuantity/cartValueMinor', () => {
    const inc = mapEventToBucketIncrements('add_to_cart', {
      isNewCart: false,
      cartItemChange: { quantity: 3, unitPriceMinor: 500 },
    });
    assert.equal(inc.cartItems, 1);
    assert.equal(inc.cartQuantity, 3);
    assert.equal(inc.cartValueMinor, 1500); // 3 * 500, integer minor units, no float math
  });

  test('remove_from_cart increments removeFromCarts unconditionally', () => {
    assert.deepEqual(mapEventToBucketIncrements('remove_from_cart', null), { removeFromCarts: 1 });
  });

  test('checkout for a brand-new checkout increments checkoutStarted', () => {
    assert.deepEqual(mapEventToBucketIncrements('checkout', { isNewCheckout: true }), { checkoutStarted: 1 });
  });

  test('checkout for an already-known checkout (duplicate event) increments nothing', () => {
    assert.deepEqual(mapEventToBucketIncrements('checkout', { isNewCheckout: false }), {});
  });

  test('purchase for a brand-new order increments orders/unitsSold/revenue counters from normalized Order data', () => {
    const inc = mapEventToBucketIncrements('purchase', {
      isNewOrder: true,
      order: { total: 10000, refundedAmount: 0 },
      orderItems: [
        { quantity: 2 },
        { quantity: 1 },
      ],
      checkoutJustCompleted: false,
    });
    assert.equal(inc.orders, 1);
    assert.equal(inc.unitsSold, 3);
    assert.equal(inc.grossRevenueMinor, 10000);
    assert.equal(inc.refundedAmountMinor, 0);
    assert.equal(inc.netRevenueMinor, 10000);
  });

  test('purchase net revenue subtracts refundedAmount using integer minor units, never floats', () => {
    const inc = mapEventToBucketIncrements('purchase', {
      isNewOrder: true,
      order: { total: 10000, refundedAmount: 2500 },
      orderItems: [],
    });
    assert.equal(inc.netRevenueMinor, 7500);
    assert.equal(Number.isInteger(inc.netRevenueMinor), true);
  });

  test('purchase §9: a duplicate order (isNewOrder false) increments nothing order-related — no double counting', () => {
    const inc = mapEventToBucketIncrements('purchase', {
      isNewOrder: false,
      order: { total: 10000, refundedAmount: 0 },
      orderItems: [],
    });
    assert.equal(inc.orders, undefined);
    assert.equal(inc.unitsSold, undefined);
    assert.equal(inc.grossRevenueMinor, undefined);
  });

  test('purchase that also completes a linked checkout increments checkoutCompleted alongside order counters', () => {
    const inc = mapEventToBucketIncrements('purchase', {
      isNewOrder: true,
      order: { total: 500, refundedAmount: 0 },
      orderItems: [],
      checkoutJustCompleted: true,
    });
    assert.equal(inc.orders, 1);
    assert.equal(inc.checkoutCompleted, 1);
  });

  test('purchase with an already-completed linked checkout does not double-count checkoutCompleted', () => {
    const inc = mapEventToBucketIncrements('purchase', {
      isNewOrder: false,
      order: { total: 500, refundedAmount: 0 },
      orderItems: [],
      checkoutJustCompleted: false,
    });
    assert.equal(inc.checkoutCompleted, undefined);
  });

  test('an unrecognized event name returns no operations', () => {
    assert.deepEqual(mapEventToBucketIncrements('some_future_event', null), {});
  });
});

describe('mapEventToProductOperations — per-product counters', () => {
  test('product_view with no resolved product returns no operations', () => {
    assert.deepEqual(mapEventToProductOperations('product_view', { product: null }), []);
  });

  test('product_view with a resolved product returns one productViews op', () => {
    const ops = mapEventToProductOperations('product_view', {
      product: { externalProductId: 'p1', name: 'Widget' },
    });
    assert.deepEqual(ops, [{ externalProductId: 'p1', productName: 'Widget', inc: { productViews: 1 } }]);
  });

  test('add_to_cart returns one addToCarts op for the resolved product', () => {
    const ops = mapEventToProductOperations('add_to_cart', {
      product: { externalProductId: 'p1', name: 'Widget' },
    });
    assert.deepEqual(ops, [{ externalProductId: 'p1', productName: 'Widget', inc: { addToCarts: 1 } }]);
  });

  test('remove_from_cart returns one removeFromCarts op keyed by the raw externalProductId, with no name (§28)', () => {
    const ops = mapEventToProductOperations('remove_from_cart', { externalProductId: 'p1' });
    assert.deepEqual(ops, [{ externalProductId: 'p1', productName: undefined, inc: { removeFromCarts: 1 } }]);
  });

  test('purchase for a duplicate order (isNewOrder false) returns no product operations', () => {
    const ops = mapEventToProductOperations('purchase', { isNewOrder: false, orderItems: [{ externalProductId: 'p1' }] });
    assert.deepEqual(ops, []);
  });

  test('purchase for a new order returns one op per order line, revenue from the normalized OrderItem total', () => {
    const ops = mapEventToProductOperations('purchase', {
      isNewOrder: true,
      orderItems: [
        { externalProductId: 'p1', productName: 'Widget', quantity: 2, total: 2000, subtotal: 2000 },
        { externalProductId: 'p2', productName: 'Gadget', quantity: 1, total: 500, subtotal: 500 },
      ],
    });
    assert.deepEqual(ops, [
      { externalProductId: 'p1', productName: 'Widget', inc: { unitsSold: 2, orders: 1, revenueMinor: 2000 } },
      { externalProductId: 'p2', productName: 'Gadget', inc: { unitsSold: 1, orders: 1, revenueMinor: 500 } },
    ]);
  });

  test('purchase order line revenue falls back to subtotal when total is absent', () => {
    const ops = mapEventToProductOperations('purchase', {
      isNewOrder: true,
      orderItems: [{ externalProductId: 'p1', productName: 'Widget', quantity: 1, subtotal: 750 }],
    });
    assert.equal(ops[0].inc.revenueMinor, 750);
  });

  test('page_view returns no product operations', () => {
    assert.deepEqual(mapEventToProductOperations('page_view', null), []);
  });
});
