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
import { summarizeTrafficSources, buildTrafficSourceSeries } from '../../utils/trafficSource.js';


function toMoney(minorAmount) {
  const value = fromMinorUnits(minorAmount);
  return Number.isFinite(value) ? value : 0;
}

function serializeRange({ from, to, granularity }) {
  return { from: from.toISOString(), to: to.toISOString(), granularity };
}


async function getOverview(website, query) {
  const { from, to, granularity } = query;
  const websiteId = website.websiteId;

  const [totals, uniqueVisitors, uniqueSessions] = await Promise.all([
    analyticsRepository.sumBucketsInRange(websiteId, granularity, from, to),
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
    conversionRate: visitorConversionRate,
  };
}


async function getTimeSeries(website, query) {
  const { from, to, granularity } = query;
  const buckets = await analyticsRepository.findBucketsInRange(website.websiteId, granularity, from, to);

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
    const product = await productRepository.findByWebsiteAndExternalId(websiteId, productId);
    if (product) {
      productName = product.name ?? null;
    } else if (!hasActivity) {
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
    checkoutQuantity: null,
    purchaseQuantity: totals.unitsSold,
    orders: totals.orders,
    revenue: toMoney(totals.revenueMinor),
    conversionRates: {
      viewToCartRate: calculateRate(totals.addToCarts, totals.productViews),
      cartToOrderRate: calculateRate(totals.orders, totals.addToCarts),
    },
  };
}


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
      addToCartRate: calculateRate(totals.addToCarts, totals.productViews),
      visitorConversionRate: rates.visitorConversionRate,
      sessionConversionRate: rates.sessionConversionRate,
      purchaseConversionRate: rates.purchaseConversionRate,
    },
  };
}


const MAX_TRAFFIC_SOURCE_SERIES = 5;

async function getTrafficSourcesReport(website, query) {
  const { from, to, granularity } = query;
  const [groups, bucketGroups] = await Promise.all([
    sessionRepository.aggregateEntryReferrers(website.websiteId, from, to),
    sessionRepository.aggregateEntryReferrersByBucket(website.websiteId, from, to, granularity),
  ]);

  const sources = summarizeTrafficSources(
    groups.map((row) => ({ referrer: row._id, sessions: row.sessions })),
    website.domain
  );

  const topSources = sources.slice(0, MAX_TRAFFIC_SOURCE_SERIES).map((row) => row.source);
  const { points, keys } = buildTrafficSourceSeries(
    bucketGroups.map((row) => ({ bucket: row._id.bucket, referrer: row._id.referrer, sessions: row.sessions })),
    website.domain,
    topSources
  );

  return {
    range: serializeRange(query),
    granularity,
    totalSessions: sources.reduce((sum, row) => sum + row.sessions, 0),
    sources,
    points,
    series: keys.sort((a, b) => topSources.indexOf(a) - topSources.indexOf(b)),
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
    cartValue: toMoney(totals.cartValueMinor),
    checkoutStarted: totals.checkoutStarted,
    checkoutCompleted: totals.checkoutCompleted,
    conversionRates: {
      cartToCheckoutRate: calculateRate(totals.checkoutStarted, totals.cartsCreated),
      checkoutCompletionRate: calculateRate(totals.checkoutCompleted, totals.checkoutStarted),
    },
  };
}


async function getRevenueReport(website, query) {
  const { from, to, granularity } = query;
  const totals = await analyticsRepository.sumBucketsInRange(website.websiteId, granularity, from, to);

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
