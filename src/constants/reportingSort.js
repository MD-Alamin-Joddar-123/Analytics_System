// Explicit allow-list for the product list report's `sort` query parameter
// (Phase 9 §12) — the ONLY way a client-supplied string can influence which
// MongoDB field a query sorts by. There is no code path anywhere in the
// reporting layer that interpolates a raw `req.query.sort` value into a
// Mongo sort spec; every sort is looked up through this map first, and an
// unrecognized key is rejected by the validator before it ever reaches a
// repository (src/validators/reporting.validator.js).
//
// Keys are the PUBLIC api names (documented in
// docs/REPORTING_API_ARCHITECTURE.md); values are the field names the
// top-products aggregation pipeline's `$group` stage actually produces
// (src/repositories/analytics/productAnalytics.repository.js) — not
// necessarily identical to the ProductAnalyticsBucket schema's own field
// names (e.g. `views` maps to the grouped `productViews`).
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

// Phase 12.5 — Tracking Observability. Same allow-list philosophy as
// PRODUCT_SORT_FIELDS above: keys are the PUBLIC api names, values are the
// actual Mongoose schema field each maps to. An unrecognized key is
// rejected by the validator before it ever reaches a repository.
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
