import { AnalyticsEventProcessed } from '../../models/AnalyticsEventProcessed.js';

export const analyticsEventProcessedRepository = {
  // Claims analytics-processing rights for one event (Phase 8 §24/§25).
  // Returns the created marker document when this call is the one that
  // gets to aggregate; returns null when the marker already existed
  // (11000 — another attempt already claimed/applied this event's
  // analytics, so the caller should treat this as an idempotent no-op).
  async claim(websiteId, eventId) {
    try {
      return await AnalyticsEventProcessed.create({ websiteId, eventId, processedAt: new Date() });
    } catch (error) {
      if (error.code === 11000) {
        return null;
      }
      throw error;
    }
  },

  // Best-effort compensating delete, called ONLY when aggregation throws
  // after a successful claim (§25) — releases the claim so a BullMQ retry
  // re-attempts aggregation from scratch instead of silently under-counting
  // forever. If this delete itself fails (e.g. a connection drop at the
  // exact wrong moment), the marker is left in place and that one event's
  // analytics remain permanently un-applied on retry — a narrow, documented
  // edge case (see docs/ANALYTICS_ARCHITECTURE.md §13) accepted in exchange
  // for never risking a double-count, which is the more harmful failure
  // direction for revenue/analytics data.
  async release(websiteId, eventId) {
    try {
      await AnalyticsEventProcessed.deleteOne({ websiteId, eventId });
    } catch {
      // best-effort — see comment above
    }
  },
};
