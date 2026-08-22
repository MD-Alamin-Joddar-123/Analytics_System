// Centralized event-name -> analytics-operation mapping (Phase 8 §10/§37).
// Every place that needs to know "what does a page_view/add_to_cart/
// purchase/etc event mean for analytics counters" reads from these two
// pure functions instead of switching on event names ad hoc — see
// analyticsAggregation.service.js, the only caller.
//
// Both functions are pure: no I/O, no Express req/res, no database access,
// deterministic given the same inputs. This makes them directly
// unit-testable (tests/analyticsMetrics.test.js) and safe to reuse from a
// future backfill/reprocessing job (§32) without re-deriving business
// rules.
//
// `commerce` is the descriptor eventProcessing.service.js's
// processCommerceEvent() returns — see that file for the exact shape. It
// is always an object (never undefined), with every field explicitly
// null/false when not applicable, so these functions never need to guard
// against a missing descriptor, only against missing fields on it.

// Website-level bucket counters (Phase 8 §2/§6). Returns a plain
// { counterName: incrementAmount } object — every key here must exist on
// the AnalyticsBucket schema. An empty object means "this event does not
// move any website-level counter" (e.g. a duplicate purchase for an
// already-known order).
export function mapEventToBucketIncrements(eventName, commerce) {
  switch (eventName) {
    case 'page_view':
      return { pageViews: 1 };

    case 'product_view':
      return { productViews: 1 };

    case 'add_to_cart': {
      const inc = { addToCarts: 1 };
      if (commerce?.isNewCart) {
        inc.cartsCreated = 1;
      }
      // Cart quantity/value are cumulative ADD activity within the bucket,
      // not the live net cart state (§17 note in
      // docs/ANALYTICS_ARCHITECTURE.md) — the normalized Cart/CartItem
      // entities from Phase 6 remain the source of truth for current cart
      // state; these counters measure add-to-cart *volume*.
      if (commerce?.cartItemChange) {
        const { quantity, unitPriceMinor } = commerce.cartItemChange;
        inc.cartItems = 1;
        inc.cartQuantity = quantity;
        inc.cartValueMinor = quantity * unitPriceMinor;
      }
      return inc;
    }

    case 'remove_from_cart':
      return { removeFromCarts: 1 };

    case 'checkout': {
      const inc = {};
      if (commerce?.isNewCheckout) {
        inc.checkoutStarted = 1;
      }
      return inc;
    }

    case 'purchase': {
      const inc = {};
      // Gated on isNewOrder (§9): a retried/duplicate purchase event for an
      // externalOrderId we've already recorded must not move any counter a
      // second time. This mirrors the exact guard order.service.js already
      // uses for OrderItem creation — not a second idempotency system, the
      // same isNewOrder decision reused.
      if (commerce?.isNewOrder && commerce.order) {
        const unitsSold = (commerce.orderItems ?? []).reduce((sum, item) => sum + item.quantity, 0);
        inc.orders = 1;
        inc.unitsSold = unitsSold;
        inc.grossRevenueMinor = commerce.order.total ?? 0;
        // Order.refundedAmount is always 0 under every event Phase 6
        // currently supports (§13/§14 — no refund event exists yet). Read
        // generically anyway so a future refund-capable phase's data
        // starts flowing through correctly without a mapping change here.
        inc.refundedAmountMinor = commerce.order.refundedAmount ?? 0;
        inc.netRevenueMinor = (commerce.order.total ?? 0) - (commerce.order.refundedAmount ?? 0);
      }
      if (commerce?.checkoutJustCompleted) {
        inc.checkoutCompleted = 1;
      }
      return inc;
    }

    default:
      return {};
  }
}

// Product-level operations (Phase 8 §8). Returns an array of
// { externalProductId, productName, inc } — one entry per distinct product
// this event touches (a purchase/checkout with multiple line items
// produces multiple entries). `productName` may be undefined when the
// triggering event didn't carry one (e.g. remove_from_cart only carries a
// productId) — see productAnalytics.repository.js for how that's handled
// without an extra lookup.
export function mapEventToProductOperations(eventName, commerce) {
  switch (eventName) {
    case 'product_view': {
      if (!commerce?.product) return [];
      return [
        {
          externalProductId: commerce.product.externalProductId,
          productName: commerce.product.name,
          inc: { productViews: 1 },
        },
      ];
    }

    case 'add_to_cart': {
      if (!commerce?.product) return [];
      return [
        {
          externalProductId: commerce.product.externalProductId,
          productName: commerce.product.name,
          inc: { addToCarts: 1 },
        },
      ];
    }

    case 'remove_from_cart': {
      if (!commerce?.externalProductId) return [];
      return [
        {
          externalProductId: commerce.externalProductId,
          productName: undefined,
          inc: { removeFromCarts: 1 },
        },
      ];
    }

    case 'purchase': {
      if (!commerce?.isNewOrder) return [];
      return (commerce.orderItems ?? []).map((orderItem) => ({
        externalProductId: orderItem.externalProductId,
        productName: orderItem.productName,
        inc: {
          unitsSold: orderItem.quantity,
          orders: 1, // see docs/ANALYTICS_ARCHITECTURE.md §8 note on multi-line-per-product orders
          revenueMinor: orderItem.total ?? orderItem.subtotal ?? 0,
        },
      }));
    }

    default:
      return [];
  }
}
