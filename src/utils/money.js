// Money precision strategy (Phase 6 §15): every monetary field on the
// normalized commerce entities (Product.price, Cart.subtotal, Order.total,
// OrderItem.unitPrice, etc.) is stored as an INTEGER in minor units, never
// a JS float. This is the one strategy used consistently across all of
// them — see docs/DATABASE_ARCHITECTURE.md for the full rationale.
//
// Simplification, documented deliberately: Phase 6 uses a fixed 2-decimal
// (i.e. Ã—100) minor-unit convention for every currency, rather than each
// currency's true ISO 4217 minor-unit exponent (most are 2, but e.g. JPY
// is 0 and BHD is 3). This matches the vast majority of currencies exactly
// and is wrong only at the margins (a small number of currencies would be
// off by a factor of 10) — an accepted simplification for this phase, not
// an oversight. A per-currency exponent table is a natural, low-risk
// follow-up once a specific misbehaving currency is actually in use.
//
// Note: Event.data (Phase 4/5) is UNCHANGED by this — it deliberately
// keeps storing whatever raw major-unit number the client sent, as the
// historical raw event record. Conversion to minor units happens only
// when building the normalized Product/Cart/Checkout/Order/OrderItem
// documents this phase introduces.
const MINOR_UNIT_MULTIPLIER = 100;

export function toMinorUnits(majorAmount) {
  if (typeof majorAmount !== 'number' || !Number.isFinite(majorAmount)) {
    return undefined;
  }
  return Math.round(majorAmount * MINOR_UNIT_MULTIPLIER);
}

export function fromMinorUnits(minorAmount) {
  if (typeof minorAmount !== 'number' || !Number.isFinite(minorAmount)) {
    return undefined;
  }
  return minorAmount / MINOR_UNIT_MULTIPLIER;
}
