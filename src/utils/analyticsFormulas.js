// Pure, reporting-layer-only formulas (Phase 9 §1/§5/§7/§12 of Phase 8's
// ANALYTICS_ARCHITECTURE.md, reused here rather than reinvented). None of
// these are ever stored — Phase 8 deliberately keeps AnalyticsBucket/
// ProductAnalyticsBucket to raw counters only (integers, no derived rate
// or average field), specifically so these calculations always run fresh,
// once, at response time, never accumulated.
//
// Every function here is defensive about zero/undefined/non-finite
// denominators (§1: "Never return NaN or Infinity") — always returns a
// clean 0 instead, never lets a bad input escape as a broken JSON number.

// A rate expressed as a percentage (0-100), rounded to `decimals` places.
// e.g. calculateRate(12, 40) -> orders / uniqueVisitors * 100 -> 30
export function calculateRate(numerator, denominator, { decimals = 2 } = {}) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  const rate = (numerator / denominator) * 100;
  if (!Number.isFinite(rate)) return 0;
  const factor = 10 ** decimals;
  return Math.round(rate * factor) / factor;
}

// A plain average (not a percentage) — e.g. average order value, average
// items per order. Returns the raw quotient by default (no rounding),
// since callers that need money precision apply their own rounding after
// converting minor -> major units (see src/utils/money.js); pass
// `decimals` explicitly when a rounded value is wanted directly.
export function calculateAverage(total, count, { decimals } = {}) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) {
    return 0;
  }
  const avg = total / count;
  if (!Number.isFinite(avg)) return 0;
  if (decimals === undefined) return avg;
  const factor = 10 ** decimals;
  return Math.round(avg * factor) / factor;
}

// Phase 8 ANALYTICS_ARCHITECTURE.md §12's three named conversion rates,
// reproduced exactly (not reinvented) — every caller in the reporting
// layer computes these the same way, from the same raw counters.
export function calculateConversionRates({ orders, uniqueVisitors, uniqueSessions, checkoutStarted, checkoutCompleted }) {
  return {
    // Phase 9 §5's example ("purchase conversion = orders / uniqueVisitors")
    // is the same formula Phase 8 named visitorConversionRate.
    visitorConversionRate: calculateRate(orders, uniqueVisitors),
    sessionConversionRate: calculateRate(orders, uniqueSessions),
    purchaseConversionRate: calculateRate(checkoutCompleted, checkoutStarted),
  };
}
