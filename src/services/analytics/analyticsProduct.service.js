import { productAnalyticsRepository } from '../../repositories/analytics/productAnalytics.repository.js';

// Thin adapter over productAnalyticsRepository — kept as its own service
// (rather than inlined into analyticsAggregation.service.js) so the
// per-product write path has a single, obvious place to extend if it ever
// needs more than a straight $inc (e.g. a future per-product uniqueness
// dimension), mirroring how analyticsAggregation.service.js delegates
// visitor/session uniqueness to their own repositories.
async function recordProductActivity(websiteId, operation, granularity, bucket) {
  const { externalProductId, productName, inc } = operation;
  if (!externalProductId || !inc || Object.keys(inc).length === 0) {
    return null;
  }
  return productAnalyticsRepository.incrementProductBucket(
    websiteId,
    externalProductId,
    granularity,
    bucket,
    productName,
    inc
  );
}

export const analyticsProductService = { recordProductActivity };
