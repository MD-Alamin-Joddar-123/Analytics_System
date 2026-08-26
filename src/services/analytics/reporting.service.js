import { analyticsRepository } from '../../repositories/analytics/analytics.repository.js';
import { productAnalyticsRepository } from '../../repositories/analytics/productAnalytics.repository.js';
import { visitorAnalyticsRepository } from '../../repositories/analytics/visitorAnalytics.repository.js';
import { sessionAnalyticsRepository } from '../../repositories/analytics/sessionAnalytics.repository.js';
import { productRepository } from '../../repositories/product.repository.js';
import { fromMinorUnits } from '../../utils/money.js';
import { calculateRate, calculateAverage, calculateConversionRates } from '../../utils/analyticsFormulas.js';
import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';
import { sessionRepository } from '../../repositories/session.repository.js';
import { summarizeTrafficSources } from '../../utils/trafficSource.js';

// Phase 9 — the reporting layer. Every function here READS the Phase 8
// aggregation collections (AnalyticsBucket/ProductAnalyticsBucket/
// AnalyticsVisitorBucket/AnalyticsSessionBucket) and shapes them into
// dashboard-friendly responses. Nothing here queries Event, nothing here
// recomputes what Phase 8 already computed — see
// docs/REPORTING_API_ARCHITECTURE.md §"No raw event recomputation" (§17).

// fromMinorUnits(0) is 0, a normal number — this wrapper only exists so a
// theoretically non-finite/undefined input (defensive; sumBucketsInRange
// always returns real numbers) can never leak a `NaN`/`undefined` into a
// response (§1: "Never return NaN or Infinity").
function toMoney(minorAmount) {
  const value = fromMinorUnits(minorAmount);
  return Number.isFinite(value) ? value : 0;
}

function serializeRange({ from, to, granularity }) {
  return { from: from.toISOString(), to: to.toISOString(), granularity };
}

// --- 1. Overview ------------------------------------------------------

async function getOverview(website, query) {
  const { from, to, granularity } = query;
  const websiteId = website.websiteId;

  const [totals, uniqueVisitors, uniqueSessions] = await Promise.all([
    analyticsRepository.sumBucketsInRange(websiteId, granularity, from, to),
    // TRUE distinct counts across the range, not a sum of per-bucket
    // uniques — see analytics.repository.js's SUMMABLE_COUNTER_FIELDS
    // comment for why summing would over-count.
    visitorAnalyticsRepository.countDistinctInRange(websiteId, granularity, from, to),
    sessionAnalyticsRepository.countDistinctInRange(websiteId, granularity, from, to),
  ]);

  const { visitorConversionRate } = calculateConversionRates({
    orders: totals.orders,
    uniqueVisitors,
    uniqueSessions,
    checkoutStarted: totals.checkoutStarted,
    checkoutCompleted: totals.checkoutCompleted,
  });

  return {
    range: serializeRange(query),
    currency: website.currency,
    pageViews: totals.pageViews,
    productViews: totals.productViews,
    addToCart: totals.addToCarts,
    removeFromCart: totals.removeFromCarts,
    checkoutStarted: totals.checkoutStarted,
    checkoutCompleted: totals.checkoutCompleted,
    orders: totals.orders,
    grossRevenue: toMoney(totals.grossRevenueMinor),
    refundedAmount: toMoney(totals.refundedAmountMinor),
    netRevenue: toMoney(totals.netRevenueMinor),
    uniqueVisitors,
    uniqueSessions,
    // Phase 8 ANALYTICS_ARCHITECTURE.md §12 calls this visitorConversionRate;
    // Phase 9 §5's own example ("purchase conversion = orders /
    // uniqueVisitors") names the identical formula — same calculation,
    // exposed under the single `conversionRate` field §1 asks for. The full
    // three-way breakdown (visitor/session/purchase) is available on the
    // Conversion report (§5) for callers that want it.
    conversionRate: visitorConversionRate,
  };
}

// --- 2. Time-series -----------------------------------------------------

async function getTimeSeries(website, query) {
  const { from, to, granularity } = query;
  const buckets = await analyticsRepository.findBucketsInRange(website.websiteId, granularity, from, to);

  // Each document IS one point already (§2: "Use the already aggregated
  // AnalyticsBucket documents") — this only formats field names/units for
  // the response, it never sums or recomputes anything across points.
  const points = buckets.map((bucket) => ({
    date: bucket.bucket.toISOString(),
    pageViews: bucket.pageViews,
    uniqueVisitors: bucket.uniqueVisitors,
    uniqueSessions: bucket.uniqueSessions,
    productViews: bucket.productViews,
    addToCart: bucket.addToCarts,
    removeFromCart: bucket.removeFromCarts,
    checkoutStarted: bucket.checkoutStarted,
    checkoutCompleted: bucket.checkoutCompleted,
    orders: bucket.orders,
    unitsSold: bucket.unitsSold,
    grossRevenue: toMoney(bucket.grossRevenueMinor),
    refundedAmount: toMoney(bucket.refundedAmountMinor),
    netRevenue: toMoney(bucket.netRevenueMinor),
  }));

  return { granularity, range: { from: from.toISOString(), to: to.toISOString() }, currency: website.currency, points };
}

// --- 3. Product analytics (top products / list) -------------------------

async function getTopProducts(website, query, sort, pagination) {
  const { from, to, granularity } = query;
  const { field, order } = sort;
  const { page, limit, skip } = pagination;

  const { items, total } = await productAnalyticsRepository.aggregateTopProducts(website.websiteId, granularity, from, to, {
    sortField: field,
    sortOrder: order,
    skip,
    limit,
  });

  const formattedItems = items.map((item) => ({
    // The external product id — item._id here is the $group key, which was
    // grouped by `$productId` (the external id), never Mongo's own _id
    // (§3: "Never expose MongoDB internal _id as the public product
    // identifier" — nothing in this pipeline ever touches ProductAnalyticsBucket's
    // own document _id in the first place).
    productId: item._id,
    productName: item.productName ?? null,
    views: item.productViews,
    addToCart: item.addToCarts,
    removeFromCart: item.removeFromCarts,
    purchaseQuantity: item.unitsSold,
    orders: item.orders,
    revenue: toMoney(item.revenueMinor),
  }));

  return {
    range: serializeRange(query),
    currency: website.currency,
    items: formattedItems,
    pagination: {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    },
  };
}

// --- 4. Product detail ----------------------------------------------------

async function getProductDetail(website, productId, query) {
  const { from, to, granularity } = query;
  const websiteId = website.websiteId;

  const totals = await productAnalyticsRepository.sumProductBucketsInRange(websiteId, productId, granularity, from, to);
  const hasActivity =
    totals.productViews > 0 ||
    totals.addToCarts > 0 ||
    totals.removeFromCarts > 0 ||
    totals.unitsSold > 0 ||
    totals.orders > 0;

  let productName = totals.productName ?? null;
  if (!productName) {
    // No name observed within the requested range — fall back to the live,
    // normalized Product document (Phase 6, reused directly, not
    // re-derived from anything).
    const product = await productRepository.findByWebsiteAndExternalId(websiteId, productId);
    if (product) {
      productName = product.name ?? null;
    } else if (!hasActivity) {
      // Neither analytics activity in range NOR a known Product at all —
      // this id is unknown to this website's catalog entirely.
      throw ApiError.notFound('Product not found.', ErrorCodes.PRODUCT_NOT_FOUND);
    }
  }

  return {
    range: serializeRange(query),
    currency: website.currency,
    productId,
    productName,
    views: totals.productViews,
    addToCart: totals.addToCarts,
    removeFromCart: totals.removeFromCarts,
    // Phase 8's ProductAnalyticsBucket does not track a per-product
    // checkout-line quantity (only website-level checkoutStarted/
    // checkoutCompleted exist — see docs/DATABASE_ARCHITECTURE.md's Phase 8
    // section). Rather than fabricate this from raw Events (explicitly
    // forbidden, §17) or silently omit the field, it is returned as `null`
    // with this documented reason — see
    // docs/REPORTING_API_ARCHITECTURE.md's Product Detail section.
    checkoutQuantity: null,
    purchaseQuantity: totals.unitsSold,
    orders: totals.orders,
    revenue: toMoney(totals.revenueMinor),
    conversionRates: {
      // Phase 9 additions (per-product funnel rates Phase 8 never defined
      // at all — not a redefinition of any Phase 8 formula): how often a
      // view led to an add-to-cart, and how often an add-to-cart led to an
      // order line for this specific product.
      viewToCartRate: calculateRate(totals.addToCarts, totals.productViews),
      cartToOrderRate: calculateRate(totals.orders, totals.addToCarts),
    },
  };
}

// --- 5. Conversion report -------------------------------------------------

async function getConversionReport(website, query) {
  const { from, to, granularity } = query;
  const websiteId = website.websiteId;

  const [totals, uniqueVisitors, uniqueSessions] = await Promise.all([
    analyticsRepository.sumBucketsInRange(websiteId, granularity, from, to),
    visitorAnalyticsRepository.countDistinctInRange(websiteId, granularity, from, to),
    sessionAnalyticsRepository.countDistinctInRange(websiteId, granularity, from, to),
  ]);

  const rates = calculateConversionRates({
    orders: totals.orders,
    uniqueVisitors,
    uniqueSessions,
    checkoutStarted: totals.checkoutStarted,
    checkoutCompleted: totals.checkoutCompleted,
  });

  return {
    range: serializeRange(query),
    productViews: totals.productViews,
    addToCart: totals.addToCarts,
    checkoutStarted: totals.checkoutStarted,
    checkoutCompleted: totals.checkoutCompleted,
    orders: totals.orders,
    uniqueVisitors,
    uniqueSessions,
    conversionRates: {
      // Phase 9 addition (funnel entry point, not a Phase 8 formula):
      // product_view -> add_to_cart rate.
      addToCartRate: calculateRate(totals.addToCarts, totals.productViews),
      // The three Phase 8 ANALYTICS_ARCHITECTURE.md §12 formulas, reused
      // verbatim — see calculateConversionRates' own doc comment.
      visitorConversionRate: rates.visitorConversionRate,
      sessionConversionRate: rates.sessionConversionRate,
      purchaseConversionRate: rates.purchaseConversionRate,
    },
  };
}

// --- 6. Cart / checkout report ---------------------------------------------

// Where the sessions in this range CAME FROM. Reads the Session
// collection directly rather than an analytics bucket: referrer is
// unbounded free text, so there is no fixed set of counters it could ever
// have been pre-aggregated into, and the same reason observability's
// visitor/session reports query their collections directly.
async function getTrafficSourcesReport(website, query) {
  const { from, to } = query;
  const groups = await sessionRepository.aggregateEntryReferrers(website.websiteId, from, to);

  const sources = summarizeTrafficSources(
    groups.map((row) => ({ referrer: row._id, sessions: row.sessions })),
    website.domain
  );

  return {
    range: serializeRange(query),
    totalSessions: sources.reduce((sum, row) => sum + row.sessions, 0),
    sources,
  };
}

async function getCartCheckoutReport(website, query) {
  const { from, to, granularity } = query;
  const totals = await analyticsRepository.sumBucketsInRange(website.websiteId, granularity, from, to);

  return {
    range: serializeRange(query),
    currency: website.currency,
    addToCart: totals.addToCarts,
    removeFromCart: totals.removeFromCarts,
    cartsCreated: totals.cartsCreated,
    cartItems: totals.cartItems,
    cartQuantity: totals.cartQuantity,
    // Cumulative add-to-cart ACTIVITY value, explicitly NOT revenue (Phase 8
    // ANALYTICS_ARCHITECTURE.md §10) — never combined with grossRevenue/
    // netRevenue in any calculation here.
    cartValue: toMoney(totals.cartValueMinor),
    checkoutStarted: totals.checkoutStarted,
    checkoutCompleted: totals.checkoutCompleted,
    conversionRates: {
      // Phase 9 addition: how many created carts progressed to a started
      // checkout.
      cartToCheckoutRate: calculateRate(totals.checkoutStarted, totals.cartsCreated),
      // == Phase 8's purchaseConversionRate (checkoutCompleted /
      // checkoutStarted) — same formula, reused, not reinvented.
      checkoutCompletionRate: calculateRate(totals.checkoutCompleted, totals.checkoutStarted),
    },
  };
}

// --- 7. Revenue report ------------------------------------------------------

async function getRevenueReport(website, query) {
  const { from, to, granularity } = query;
  const totals = await analyticsRepository.sumBucketsInRange(website.websiteId, granularity, from, to);

  // Average computed on the integer minor-unit total first (no
  // accumulation, a single division), converted to major units once at
  // the very end — never floating-point-accumulated money (§16).
  const averageOrderValueMinor = calculateAverage(totals.grossRevenueMinor, totals.orders);

  return {
    range: serializeRange(query),
    currency: website.currency,
    grossRevenue: toMoney(totals.grossRevenueMinor),
    refundedAmount: toMoney(totals.refundedAmountMinor),
    netRevenue: toMoney(totals.netRevenueMinor),
    orderCount: totals.orders,
    averageOrderValue: toMoney(averageOrderValueMinor),
  };
}

export const reportingService = {
  getOverview,
  getTimeSeries,
  getTopProducts,
  getProductDetail,
  getConversionReport,
  getCartCheckoutReport,
  getTrafficSourcesReport,
  getRevenueReport,
};
