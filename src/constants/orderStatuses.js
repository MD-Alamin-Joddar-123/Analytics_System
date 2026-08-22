// Controlled status vocabularies for the commerce entities (Phase 6).
// Deliberately closed sets, not arbitrary client strings — kept small and
// generic enough that a platform-specific status (Shopify, WooCommerce,
// custom) can be mapped onto one of these without losing the essential
// meaning. Extending these lists is expected as more platforms are
// integrated; that's why they live in one shared file rather than being
// inlined in each model.

export const ORDER_STATUSES = ['pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded'];

export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'];

// Not fed by any event in Phase 6 — no current data source signals
// fulfillment state. Reserved for a future phase (shipping
// webhooks/integrations) to update; defaults to 'unfulfilled'.
export const FULFILLMENT_STATUSES = ['unfulfilled', 'fulfilled', 'partially_fulfilled'];

// 'abandoned' is a defined, valid value that nothing in Phase 6 ever sets —
// detecting abandonment requires time-based evaluation (a worker), which
// is explicitly out of scope here. See checkout.service.js.
export const CHECKOUT_STATUSES = ['started', 'completed', 'abandoned'];

export const PRODUCT_STATUSES = ['active', 'archived'];
