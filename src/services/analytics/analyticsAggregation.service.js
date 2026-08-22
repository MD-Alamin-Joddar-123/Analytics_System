import { analyticsEventProcessedRepository } from '../../repositories/analytics/analyticsEventProcessed.repository.js';
import { analyticsRepository } from '../../repositories/analytics/analytics.repository.js';
import { visitorAnalyticsRepository } from '../../repositories/analytics/visitorAnalytics.repository.js';
import { sessionAnalyticsRepository } from '../../repositories/analytics/sessionAnalytics.repository.js';
import { analyticsProductService } from './analyticsProduct.service.js';
import { getBucket } from './analyticsBucket.service.js';
import { SUPPORTED_GRANULARITIES } from '../../constants/analyticsGranularity.js';
import { mapEventToBucketIncrements, mapEventToProductOperations } from '../../constants/analyticsMetrics.js';
import { logger } from '../../utils/logger.js';

// Best-effort currency snapshot (§29): prefer whichever normalized,
// server-computed entity is already available on the commerce descriptor
// (Order.currency, Product.currency) over the raw client-supplied
// event.data.currency, since those have already passed through Phase 6's
// validation/normalization. Falls all the way back to the raw event field
// only when no normalized entity was resolved (e.g. page_view has neither,
// remove_from_cart doesn't resolve a Product). Returns undefined — not a
// guess — when nothing is available; AnalyticsBucket.currency is then left
// untouched for that write, which is harmless since a page-view-only
// bucket carries no monetary counters anyway.
function resolveCurrency(event, commerce) {
  return commerce?.order?.currency ?? commerce?.product?.currency ?? event.data?.currency ?? undefined;
}

// The orchestrator (Phase 8 §19/§20): Worker -> eventProcessing.service ->
// [this]. Called once per successfully-processed event, AFTER
// visitor/session/commerce resolution and BEFORE the Event is marked
// `completed` (§26) — an aggregation failure here must still fail the
// whole processing attempt so BullMQ retries it, exactly like a
// visitor/session/commerce failure already does.
//
// Idempotency/consistency model (§24/§25, fully documented in
// docs/ANALYTICS_ARCHITECTURE.md): this function first claims an
// AnalyticsEventProcessed marker for (websiteId, eventId). If the claim
// fails (already claimed by an earlier attempt), it returns immediately —
// analytics for this event were already applied, or a concurrent attempt
// is already applying them; either way, applying them again here would
// double-count. If the claim succeeds but aggregation later throws, the
// claim is released (compensating delete) so the NEXT retry re-attempts
// aggregation from scratch rather than being permanently skipped. This
// guarantees no double-counting; it does NOT guarantee exactly-once in the
// face of a hard process crash between the claim and the compensating
// delete — that narrow gap is a documented, accepted undercount risk, not
// a claimed exactly-once guarantee (§25 explicitly warns against claiming
// more than is actually provided).
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

      // Unique visitor/session counting (§11/§12): claim-via-unique-insert
      // against a dedicated small collection, never an in-document array.
      // Graceful degradation matches Phase 5: an event with no
      // anonymousId/sessionId simply doesn't contribute to that counter,
      // it's still aggregated for everything else.
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
        // eslint-disable-next-line no-await-in-loop
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
    throw error; // propagate so eventProcessing.service.js fails the attempt and BullMQ retries (§27)
  }
}

export const analyticsAggregationService = { aggregateEvent };
