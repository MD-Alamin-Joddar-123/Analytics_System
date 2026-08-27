import { analyticsEventProcessedRepository } from '../../repositories/analytics/analyticsEventProcessed.repository.js';
import { analyticsRepository } from '../../repositories/analytics/analytics.repository.js';
import { visitorAnalyticsRepository } from '../../repositories/analytics/visitorAnalytics.repository.js';
import { sessionAnalyticsRepository } from '../../repositories/analytics/sessionAnalytics.repository.js';
import { analyticsProductService } from './analyticsProduct.service.js';
import { getBucket } from './analyticsBucket.service.js';
import { SUPPORTED_GRANULARITIES } from '../../constants/analyticsGranularity.js';
import { mapEventToBucketIncrements, mapEventToProductOperations } from '../../constants/analyticsMetrics.js';
import { logger } from '../../utils/logger.js';

function resolveCurrency(event, commerce) {
  return commerce?.order?.currency ?? commerce?.product?.currency ?? event.data?.currency ?? undefined;
}

async function aggregateEvent(event, { visitor, session, commerce } = {}) {
  const logContext = { websiteId: event.websiteId, eventId: event.eventId, eventName: event.eventName };

  const claimed = await analyticsEventProcessedRepository.claim(event.websiteId, event.eventId);
  if (!claimed) {
    logger.info('analytics_aggregation_already_claimed', logContext);
    return { aggregated: false, reason: 'already_claimed' };
  }

  try {
    const baseInc = mapEventToBucketIncrements(event.eventName, commerce);
    const productOps = mapEventToProductOperations(event.eventName, commerce);
    const currency = resolveCurrency(event, commerce);
    const anonymousId = event.anonymousId;
    const sessionId = session?.sessionId ?? event.sessionId;

    for (const granularity of SUPPORTED_GRANULARITIES) {
      const bucket = getBucket(event.timestamp, granularity);
      const inc = { ...baseInc };

      if (anonymousId) {
        const isNewVisitorInBucket = await visitorAnalyticsRepository.claim(
          event.websiteId,
          granularity,
          bucket,
          anonymousId
        );
        if (isNewVisitorInBucket) {
          inc.uniqueVisitors = 1;
        }
      }
      if (sessionId) {
        const isNewSessionInBucket = await sessionAnalyticsRepository.claim(
          event.websiteId,
          granularity,
          bucket,
          sessionId
        );
        if (isNewSessionInBucket) {
          inc.uniqueSessions = 1;
        }
      }

      if (Object.keys(inc).length > 0) {
        await analyticsRepository.incrementBucket(event.websiteId, granularity, bucket, currency, inc);
      }

      for (const op of productOps) {
        await analyticsProductService.recordProductActivity(event.websiteId, op, granularity, bucket);
      }
    }

    logger.info('analytics_aggregation_completed', logContext);
    return { aggregated: true };
  } catch (error) {
    await analyticsEventProcessedRepository.release(event.websiteId, event.eventId);
    logger.error('analytics_aggregation_failed', {
      ...logContext,
      errorType: error.name,
      errorMessage: error.message,
    });
    throw error;
  }
}

export const analyticsAggregationService = { aggregateEvent };
