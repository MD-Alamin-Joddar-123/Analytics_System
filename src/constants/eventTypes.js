// Events the collector currently accepts and knows how to validate the
// `data` shape for. Each has a dedicated validator in event.validator.js.
export const SUPPORTED_EVENTS = [
  'page_view',
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'checkout',
  'purchase',
];

// Names reserved for future phases. Listed here so the contract is
// documented and stable, but NOT accepted yet — each would need its own
// `data` validator (and, for "custom", a deliberate design decision about
// what a safe free-form payload looks like) before being enabled. Sending
// one of these today is rejected the same as any other unknown event name
// (UNSUPPORTED_EVENT), not silently accepted.
export const RESERVED_FUTURE_EVENTS = [
  'search',
  'wishlist_add',
  'wishlist_remove',
  'cart_view',
  'begin_checkout',
  'payment',
  'refund',
  'login',
  'signup',
  'custom',
];

// Phase 7 event processing state machine — see docs/QUEUE_ARCHITECTURE.md.
export const PROCESSING_STATUSES = ['pending', 'processing', 'completed', 'failed'];
