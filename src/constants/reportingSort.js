export const PRODUCT_SORT_FIELDS = Object.freeze({
  revenue: 'revenueMinor',
  orders: 'orders',
  views: 'productViews',
  addToCart: 'addToCarts',
  purchaseQuantity: 'unitsSold',
});

export const DEFAULT_PRODUCT_SORT = 'revenue';
export const DEFAULT_SORT_ORDER = 'desc';
export const SORT_ORDERS = Object.freeze(['asc', 'desc']);

export const VISITOR_SORT_FIELDS = Object.freeze({
  firstSeenAt: 'firstSeenAt',
  lastSeenAt: 'lastSeenAt',
  sessionCount: 'sessionCount',
  eventCount: 'eventCount',
});
export const DEFAULT_VISITOR_SORT = 'lastSeenAt';

export const SESSION_SORT_FIELDS = Object.freeze({
  startedAt: 'startedAt',
  lastActivityAt: 'lastActivityAt',
  eventCount: 'eventCount',
  pageViewCount: 'pageViewCount',
});
export const DEFAULT_SESSION_SORT = 'startedAt';

export const EVENT_SORT_FIELDS = Object.freeze({
  timestamp: 'timestamp',
  receivedAt: 'receivedAt',
});
export const DEFAULT_EVENT_SORT = 'timestamp';

export const ORDER_SORT_FIELDS = Object.freeze({
  purchasedAt: 'purchasedAt',
  orderCreatedAt: 'orderCreatedAt',
  total: 'total',
});
export const DEFAULT_ORDER_SORT = 'purchasedAt';
