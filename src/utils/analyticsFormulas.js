
export function calculateRate(numerator, denominator, { decimals = 2 } = {}) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  const rate = (numerator / denominator) * 100;
  if (!Number.isFinite(rate)) return 0;
  const factor = 10 ** decimals;
  return Math.round(rate * factor) / factor;
}

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

export function calculateConversionRates({ orders, uniqueVisitors, uniqueSessions, checkoutStarted, checkoutCompleted }) {
  return {
    visitorConversionRate: calculateRate(orders, uniqueVisitors),
    sessionConversionRate: calculateRate(orders, uniqueSessions),
    purchaseConversionRate: calculateRate(checkoutCompleted, checkoutStarted),
  };
}
