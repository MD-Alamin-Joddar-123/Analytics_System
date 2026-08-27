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
      commerce.externalProductId = data.productId ?? null;
      break;
    }

    case 'checkout': {
      for (const item of data.items ?? []) {
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

async function processEvent(eventObjectId) {
  const event = await eventRepository.findById(eventObjectId);

  if (!event) {
    logger.warn('event_processing_event_not_found', { eventObjectId: String(eventObjectId) });
    return { processed: false, reason: 'event_not_found' };
  }

  const logContext = {
    eventObjectId: String(event._id),
    websiteId: event.websiteId,
    eventId: event.eventId,
  };

  if (event.processingStatus === 'completed') {
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

    await analyticsAggregationService.aggregateEvent(event, { visitor, session, commerce });

    await eventRepository.markProcessingCompleted(event._id, {
      visitorId: visitor?._id,
      sessionObjectId: session?._id,
    });

    logger.info('event_processing_completed', logContext);
    return { processed: true };
  } catch (error) {
    await eventRepository.markProcessingFailed(event._id, error.message);
    logger.error('event_processing_failed', {
      ...logContext,
      errorType: error.name,
      errorMessage: error.message,
    });
    throw error;
  }
}

export const eventProcessingService = { processEvent };
