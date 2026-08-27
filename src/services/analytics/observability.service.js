import { visitorRepository } from '../../repositories/visitor.repository.js';
import { sessionRepository } from '../../repositories/session.repository.js';
import { eventRepository } from '../../repositories/event.repository.js';
import { orderRepository } from '../../repositories/order.repository.js';
import { orderItemRepository } from '../../repositories/orderItem.repository.js';
import { checkoutRepository } from '../../repositories/checkout.repository.js';
import { fromMinorUnits } from '../../utils/money.js';
import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';
import {
  SESSION_TIMELINE_MAX_EVENTS,
  VISITOR_RECENT_EVENTS_MAX,
  VISITOR_SESSION_HISTORY_MAX,
} from '../../constants/reportingLimits.js';


function toMoney(minorAmount) {
  if (minorAmount === undefined || minorAmount === null) return null;
  const value = fromMinorUnits(minorAmount);
  return Number.isFinite(value) ? value : 0;
}

function isoOrNull(date) {
  return date ? new Date(date).toISOString() : null;
}

function serializeDevice(doc) {
  return {
    userAgent: doc.userAgent ?? null,
    language: doc.language ?? null,
    timezone: doc.timezone ?? null,
    screenWidth: doc.screenWidth ?? null,
    screenHeight: doc.screenHeight ?? null,
  };
}


function serializeVisitorSummary(visitor) {
  return {
    visitorId: visitor.anonymousId,
    firstSeenAt: isoOrNull(visitor.firstSeenAt),
    lastSeenAt: isoOrNull(visitor.lastSeenAt),
    sessionCount: visitor.sessionCount ?? 0,
    eventCount: visitor.eventCount ?? 0,
    firstUrl: visitor.firstUrl ?? null,
    lastUrl: visitor.lastUrl ?? null,
    device: serializeDevice(visitor),
  };
}

function serializeSessionHistoryEntry(session) {
  return {
    sessionId: session.sessionId,
    startedAt: isoOrNull(session.startedAt),
    lastActivityAt: isoOrNull(session.lastActivityAt),
    endedAt: isoOrNull(session.endedAt),
    pageViewCount: session.pageViewCount ?? 0,
    eventCount: session.eventCount ?? 0,
    landingPage: session.landingPage ?? null,
    exitPage: session.exitPage ?? null,
  };
}

function serializeRecentEvent(event) {
  return {
    eventId: event.eventId,
    eventName: event.eventName,
    timestamp: isoOrNull(event.timestamp),
    url: event.url ?? null,
    path: event.path ?? null,
  };
}

async function listVisitors(website, sort, pagination) {
  const websiteId = website.websiteId;
  const { field, order } = sort;
  const { page, limit, skip } = pagination;

  const [visitors, total] = await Promise.all([
    visitorRepository.findManyByWebsite(websiteId, { sortField: field, sortOrder: order, skip, limit }),
    visitorRepository.countByWebsite(websiteId),
  ]);

  return {
    items: visitors.map(serializeVisitorSummary),
    pagination: { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 },
  };
}

async function getVisitorDetail(website, visitorId) {
  const websiteId = website.websiteId;
  const visitor = await visitorRepository.findByWebsiteAndAnonymousId(websiteId, visitorId);
  if (!visitor) {
    throw ApiError.notFound('Visitor not found.', ErrorCodes.VISITOR_NOT_FOUND);
  }

  const [sessions, recentEvents] = await Promise.all([
    sessionRepository.findManyByWebsiteAndVisitor(websiteId, visitor._id, { limit: VISITOR_SESSION_HISTORY_MAX }),
    eventRepository.findManyByWebsiteFiltered(
      websiteId,
      { anonymousId: visitor.anonymousId },
      { sortField: 'timestamp', sortOrder: -1, skip: 0, limit: VISITOR_RECENT_EVENTS_MAX }
    ),
  ]);

  return {
    ...serializeVisitorSummary(visitor),
    firstReferrer: visitor.firstReferrer ?? null,
    lastReferrer: visitor.lastReferrer ?? null,
    sessions: sessions.map(serializeSessionHistoryEntry),
    recentEvents: recentEvents.map(serializeRecentEvent),
  };
}


function serializeSessionSummary(session) {
  return {
    sessionId: session.sessionId,
    visitorId: session.anonymousId,
    startedAt: isoOrNull(session.startedAt),
    lastActivityAt: isoOrNull(session.lastActivityAt),
    endedAt: isoOrNull(session.endedAt),
    landingPage: session.landingPage ?? null,
    exitPage: session.exitPage ?? null,
    entryReferrer: session.entryReferrer ?? null,
    pageViewCount: session.pageViewCount ?? 0,
    eventCount: session.eventCount ?? 0,
  };
}

function serializeEventData(data) {
  if (!data) return null;
  const out = {};
  if (data.productId !== undefined) out.productId = data.productId;
  if (data.name !== undefined) out.name = data.name;
  if (data.price !== undefined) out.price = data.price;
  if (data.quantity !== undefined) out.quantity = data.quantity;
  if (data.currency !== undefined) out.currency = data.currency;
  if (data.orderId !== undefined) out.orderId = data.orderId;
  if (data.revenue !== undefined) out.revenue = data.revenue;
  if (data.cartValue !== undefined) out.cartValue = data.cartValue;
  if (data.cartId !== undefined) out.cartId = data.cartId;
  if (data.checkoutId !== undefined) out.checkoutId = data.checkoutId;
  if (data.subtotal !== undefined) out.subtotal = data.subtotal;
  if (data.discount !== undefined) out.discount = data.discount;
  if (data.shipping !== undefined) out.shipping = data.shipping;
  if (data.tax !== undefined) out.tax = data.tax;
  if (data.total !== undefined) out.total = data.total;
  if (data.paymentStatus !== undefined) out.paymentStatus = data.paymentStatus;
  if (Array.isArray(data.items)) {
    out.items = data.items.map((item) => ({
      productId: item.productId,
      name: item.name ?? null,
      price: item.price,
      quantity: item.quantity,
    }));
  }
  return out;
}

function serializeTimelineEvent(event) {
  return {
    eventId: event.eventId,
    eventName: event.eventName,
    timestamp: isoOrNull(event.timestamp),
    url: event.url ?? null,
    path: event.path ?? null,
    data: serializeEventData(event.data),
  };
}

async function listSessions(website, sort, pagination) {
  const websiteId = website.websiteId;
  const { field, order } = sort;
  const { page, limit, skip } = pagination;

  const [sessions, total] = await Promise.all([
    sessionRepository.findManyByWebsite(websiteId, { sortField: field, sortOrder: order, skip, limit }),
    sessionRepository.countByWebsite(websiteId),
  ]);

  return {
    items: sessions.map(serializeSessionSummary),
    pagination: { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 },
  };
}

async function getSessionDetail(website, sessionId) {
  const websiteId = website.websiteId;
  const session = await sessionRepository.findByWebsiteAndSessionId(websiteId, sessionId);
  if (!session) {
    throw ApiError.notFound('Session not found.', ErrorCodes.SESSION_NOT_FOUND);
  }

  const timeline = await eventRepository.findManyByWebsiteAndSessionObjectId(websiteId, session._id, {
    limit: SESSION_TIMELINE_MAX_EVENTS,
  });

  return {
    ...serializeSessionSummary(session),
    timeline: timeline.map(serializeTimelineEvent),
  };
}


function serializeEventSummary(event) {
  return {
    eventId: event.eventId,
    eventName: event.eventName,
    timestamp: isoOrNull(event.timestamp),
    visitorId: event.anonymousId ?? null,
    sessionId: event.sessionId ?? null,
    url: event.url ?? null,
    processingStatus: event.processingStatus,
  };
}

function serializeEventDetail(event) {
  return {
    eventId: event.eventId,
    eventName: event.eventName,
    eventVersion: event.eventVersion,
    timestamp: isoOrNull(event.timestamp),
    receivedAt: isoOrNull(event.receivedAt),
    url: event.url ?? null,
    path: event.path ?? null,
    title: event.title ?? null,
    referrer: event.referrer ?? null,
    visitorId: event.anonymousId ?? null,
    sessionId: event.sessionId ?? null,
    device: serializeDevice(event),
    data: serializeEventData(event.data),
    processingStatus: event.processingStatus,
    processedAt: isoOrNull(event.processedAt),
  };
}

async function listEvents(website, filters, sort, pagination) {
  const websiteId = website.websiteId;
  const { field, order } = sort;
  const { page, limit, skip } = pagination;

  const [events, total] = await Promise.all([
    eventRepository.findManyByWebsiteFiltered(websiteId, filters, { sortField: field, sortOrder: order, skip, limit }),
    eventRepository.countByWebsiteFiltered(websiteId, filters),
  ]);

  return {
    items: events.map(serializeEventSummary),
    pagination: { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 },
  };
}

async function getEventDetail(website, eventId) {
  const event = await eventRepository.findByWebsiteAndEventId(website.websiteId, eventId);
  if (!event) {
    throw ApiError.notFound('Event not found.', ErrorCodes.EVENT_NOT_FOUND);
  }
  return serializeEventDetail(event);
}


function serializeOrderSummary(order, itemCount) {
  return {
    orderId: order.externalOrderId,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    currency: order.currency,
    total: toMoney(order.total),
    itemCount: itemCount ?? 0,
    orderCreatedAt: isoOrNull(order.orderCreatedAt),
    purchasedAt: isoOrNull(order.purchasedAt),
  };
}

function serializeOrderItem(item) {
  return {
    productId: item.externalProductId,
    productName: item.productName ?? null,
    sku: item.sku ?? null,
    unitPrice: toMoney(item.unitPrice),
    quantity: item.quantity,
    subtotal: toMoney(item.subtotal),
    discount: toMoney(item.discount),
    total: toMoney(item.total),
    currency: item.currency,
  };
}

async function listOrders(website, sort, pagination) {
  const websiteId = website.websiteId;
  const { field, order } = sort;
  const { page, limit, skip } = pagination;

  const [orders, total] = await Promise.all([
    orderRepository.findManyByWebsite(websiteId, { sortField: field, sortOrder: order, skip, limit }),
    orderRepository.countByWebsite(websiteId),
  ]);

  const itemCounts = await orderItemRepository.countByOrders(
    websiteId,
    orders.map((order) => order._id)
  );

  return {
    items: orders.map((order) => serializeOrderSummary(order, itemCounts[String(order._id)])),
    pagination: { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 },
  };
}

async function getOrderDetail(website, orderId) {
  const websiteId = website.websiteId;
  const order = await orderRepository.findByWebsiteAndExternalOrderId(websiteId, orderId);
  if (!order) {
    throw ApiError.notFound('Order not found.', ErrorCodes.ORDER_NOT_FOUND);
  }

  const items = await orderItemRepository.findByOrder(websiteId, order._id);

  let linkedCheckout = null;
  const purchaseEvent = await eventRepository.findPurchaseEventByOrderId(websiteId, orderId);
  const checkoutId = purchaseEvent?.data?.checkoutId;
  if (checkoutId) {
    const checkout = await checkoutRepository.findByWebsiteAndCheckoutId(websiteId, checkoutId);
    if (checkout) {
      linkedCheckout = {
        checkoutId: checkout.checkoutId,
        status: checkout.status,
        startedAt: isoOrNull(checkout.startedAt),
        completedAt: isoOrNull(checkout.completedAt),
      };
    }
  }

  return {
    orderId: order.externalOrderId,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    currency: order.currency,
    subtotal: toMoney(order.subtotal),
    discount: toMoney(order.discount),
    shipping: toMoney(order.shipping),
    tax: toMoney(order.tax),
    total: toMoney(order.total),
    refundedAmount: toMoney(order.refundedAmount),
    orderCreatedAt: isoOrNull(order.orderCreatedAt),
    purchasedAt: isoOrNull(order.purchasedAt),
    visitorId: order.anonymousId ?? null,
    sessionId: order.sessionId ?? null,
    items: items.map(serializeOrderItem),
    linkedCheckout,
  };
}

export const observabilityService = {
  listVisitors,
  getVisitorDetail,
  listSessions,
  getSessionDetail,
  listEvents,
  getEventDetail,
  listOrders,
  getOrderDetail,
};
