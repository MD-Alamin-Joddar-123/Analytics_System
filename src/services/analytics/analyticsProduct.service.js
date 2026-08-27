import { productAnalyticsRepository } from '../../repositories/analytics/productAnalytics.repository.js';

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
