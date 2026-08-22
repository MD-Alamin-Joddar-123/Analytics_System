import { eventRepository } from '../../repositories/event.repository.js';
import { visitorService } from '../visitor/visitor.service.js';
import { sessionService } from '../session/session.service.js';
import { productService } from '../product/product.service.js';
import { cartService } from '../cart/cart.service.js';
import { checkoutService } from '../checkout/checkout.service.js';
import { orderService } from '../order/order.service.js';
import { analyticsAggregationService } from '../analytics/analyticsAggregation.service.js';
import { toMinorUnits } from '../../utils/money.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// The commerce descriptor shape returned by processCommerceEvent — always
// this exact shape, every field explicitly null/false/empty when not
// applicable, never undefined. This is what lets analyticsAggregation.service
// (via the pure mapping in src/constants/analyticsMetrics.js) treat every
// event uniformly without guarding against a missing descriptor. See
// docs/ANALYTICS_ARCHITECTURE.md for how each field maps to analytics
// counters.
function emptyCommerceDescriptor() {
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
  };
}

// Moved here from event.service.js during the Phase 7 ingestion/processing
// split (§13) — commerce dispatch now only ever runs from the worker,
// never synchronously in the HTTP request path. Logic is UNCHANGED from
// Phase 6 (just relocated), aside from the Phase 8 addition of building
// and returning the commerce descriptor so analyticsAggregation.service.js
// can consume the SAME isNew/resolved-entity decisions this function
// already made — never a second, parallel idempotency/resolution system
// (§9, §13, §17, §18).
async function processCommerceEvent(event, { visitor, session }) {
  const commerce = emptyCommerceDescriptor();

  const data = event.data;
  if (!data) {
    return commerce;
  }

  const websiteId = event.websiteId;
  const receivedAt = event.receivedAt;

  switch (event.eventName) {
    case 'product_view': {
      commerce.product = await productService.resolveProduct(
        websiteId,
        { externalProductId: data.productId, name: data.name, price: data.price, currency: data.currency },
        receivedAt
      );
      break;
    }

    case 'add_to_cart': {
      const product = await productService.resolveProduct(
        websiteId,
        { externalProductId: data.productId, name: data.name, price: data.price, currency: data.currency },
        receivedAt
      );
      commerce.product = product;
      const { cart, isNewCart, cartItemChange } = await cartService.addToCart(
        websiteId,
        { cartId: data.cartId, product, name: data.name, price: data.price, quantity: data.quantity, currency: data.currency },
        { visitor, session, receivedAt }
      );
      commerce.cart = cart;
      commerce.isNewCart = isNewCart;
      commerce.cartItemChange = cartItemChange;
      break;
    }

    case 'remove_from_cart': {
      const cart = await cartService.removeFromCart(
        websiteId,
        { cartId: data.cartId, externalProductId: data.productId, quantity: data.quantity },
        { receivedAt }
      );
      commerce.cart = cart;
      // Read directly off the event data rather than round-tripping
      // through cartService's return value — removeFromCart's own logic
      // doesn't need to change to expose this, it's already right here.
      commerce.externalProductId = data.productId ?? null;
      break;
    }

    case 'checkout': {
      for (const item of data.items ?? []) {
        // eslint-disable-next-line no-await-in-loop
        await productService.resolveProduct(
          websiteId,
          { externalProductId: item.productId, name: item.name, price: item.price, currency: data.currency },
          receivedAt
        );
      }
      const { checkout, isNew: isNewCheckout } = await checkoutService.upsertCheckout(
        websiteId,
        {
          checkoutId: data.checkoutId,
          cartId: data.cartId,
          currency: data.currency,
          subtotalMinor: toMinorUnits(data.subtotal),
          discountMinor: toMinorUnits(data.discount),
          shippingMinor: toMinorUnits(data.shipping),
          taxMinor: toMinorUnits(data.tax),
          totalMinor: toMinorUnits(data.total),
        },
        { visitor, session, receivedAt }
      );
      commerce.checkout = checkout;
      commerce.isNewCheckout = isNewCheckout;
      break;
    }

    case 'purchase': {
      const productItems = [];
      for (const item of data.items ?? []) {
        // eslint-disable-next-line no-await-in-loop
        const product = await productService.resolveProduct(
          websiteId,
          { externalProductId: item.productId, name: item.name, price: item.price, currency: data.currency },
          receivedAt
        );
        productItems.push({ item, product });
      }

      const { order, isNew: isNewOrder } = await orderService.upsertOrder(
        websiteId,
        {
          externalOrderId: data.orderId,
          currency: data.currency,
          subtotalMinor: toMinorUnits(data.subtotal),
          discountMinor: toMinorUnits(data.discount),
          shippingMinor: toMinorUnits(data.shipping),
          taxMinor: toMinorUnits(data.tax),
          totalMinor: toMinorUnits(data.total),
          paymentStatus: data.paymentStatus,
        },
        { visitor, session, receivedAt }
      );
      commerce.order = order;
      commerce.isNewOrder = isNewOrder;

      if (isNewOrder) {
        commerce.orderItems = await orderService.createOrderItems(websiteId, order, productItems, data.currency);
      }

      if (data.checkoutId) {
        const { checkout, justCompleted } = await checkoutService.completeCheckoutIfLinked(
          websiteId,
          data.checkoutId,
          receivedAt
        );
        commerce.checkout = checkout;
        commerce.checkoutJustCompleted = justCompleted;
      }
      break;
    }

    default:
      break;
  }

  return commerce;
}

// The reusable processing core (§6/§13): Worker -> [this] -> Visitor/
// Session/Commerce Services -> Repositories -> MongoDB. Called by the
// BullMQ job processor (src/workers/event.worker.js), and directly by
// tests — this function has no BullMQ/Redis dependency of its own, so it
// can be exercised without any real queue infrastructure.
async function processEvent(eventObjectId) {
  const event = await eventRepository.findById(eventObjectId);

  if (!event) {
    // A job referencing an Event that no longer exists (shouldn't happen
    // in normal operation — events are never deleted — but a job must
    // never throw on this; there is nothing to retry toward).
    logger.warn('event_processing_event_not_found', { eventObjectId: String(eventObjectId) });
    return { processed: false, reason: 'event_not_found' };
  }

  const logContext = {
    eventObjectId: String(event._id),
    websiteId: event.websiteId,
    eventId: event.eventId,
  };

  if (event.processingStatus === 'completed') {
    // Idempotent no-op (§11): a duplicate/stale job for an event that's
    // already been fully processed — e.g. the ingestion-side re-enqueue
    // for a duplicate submission (§15), or BullMQ redelivering a job that
    // actually succeeded. The underlying Product/Cart/Order upserts would
    // also be safe to re-run on their own (external-id-keyed), but this
    // guard additionally protects the Visitor/Session/Cart counter
    // increments, which are NOT independently idempotent — see
    // docs/QUEUE_ARCHITECTURE.md for the one narrow scenario (a crash
    // between incrementing a counter and this status flipping to
    // 'completed') this guard does not cover.
    logger.info('event_processing_already_completed', logContext);
    return { processed: false, reason: 'already_completed' };
  }

  await eventRepository.markProcessingStarted(event._id);
  logger.info('event_processing_started', { ...logContext, attempt: (event.processingAttempts ?? 0) + 1 });

  try {
    const pageIdentifier = event.url ?? event.path;
    const visitorContext = {
      receivedAt: event.receivedAt,
      url: pageIdentifier,
      referrer: event.referrer,
      userAgent: event.userAgent,
      language: event.language,
      timezone: event.timezone,
      screenWidth: event.screenWidth,
      screenHeight: event.screenHeight,
    };

    const { visitor, isNew: isNewVisitor } = await visitorService.resolveVisitor(
      event.websiteId,
      event.anonymousId,
      visitorContext
    );

    const { session, isNew: isNewSession } = await sessionService.resolveSession(
      event.websiteId,
      event.sessionId,
      visitor,
      visitorContext,
      env.sessionTimeoutMinutes * 60 * 1000
    );

    if (visitor) {
      await visitorService.recordVisitorActivity(visitor, {
        isNewVisitor,
        session,
        isNewSession,
        receivedAt: event.receivedAt,
        url: pageIdentifier,
        referrer: event.referrer,
      });
    }
    if (session) {
      await sessionService.recordSessionActivity(session, {
        eventName: event.eventName,
        receivedAt: event.receivedAt,
        url: pageIdentifier,
      });
    }

    const commerce = await processCommerceEvent(event, { visitor, session });

    // Phase 8 §26: analytics aggregation is part of the required
    // processing pipeline — an Event is not `completed` until it has run.
    // A failure here throws exactly like a visitor/session/commerce
    // failure does, so BullMQ retries the whole attempt (§27); it is
    // never swallowed to let the Event complete anyway.
    await analyticsAggregationService.aggregateEvent(event, { visitor, session, commerce });

    await eventRepository.markProcessingCompleted(event._id, {
      visitorId: visitor?._id,
      sessionObjectId: session?._id,
    });

    logger.info('event_processing_completed', logContext);
    return { processed: true };
  } catch (error) {
    await eventRepository.markProcessingFailed(event._id, error.message);
    // Structured, bounded fields only (§24) — never the raw Event/error
    // object, which could otherwise leak arbitrary payload contents.
    logger.error('event_processing_failed', {
      ...logContext,
      errorType: error.name,
      errorMessage: error.message,
    });
    throw error; // rethrow so BullMQ registers a failed attempt and retries per policy
  }
}

export const eventProcessingService = { processEvent };
