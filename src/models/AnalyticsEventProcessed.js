import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';

// The analytics-layer idempotency marker (Phase 8 §24/§25) — completely
// separate from Event.processingStatus (Phase 7), which tracks
// visitor/session/commerce processing, not analytics aggregation.
// Presence of a document here means "analytics aggregation has been
// claimed/applied for this event"; its absence means it hasn't (or a
// failed attempt released its claim — see analyticsAggregation.service.js
// for the claim-then-compensate-on-failure flow this backs).
//
// One document per (websiteId, eventId) — the SAME identity pair as the
// Event model's own idempotency index, since this collection exists to
// answer "has THIS event's analytics been applied", not anything
// bucket-scoped.
const analyticsEventProcessedSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    eventId: { type: String, required: true, trim: true },
    processedAt: { type: Date, required: true },
  },
  baseSchemaOptions
);

analyticsEventProcessedSchema.index({ websiteId: 1, eventId: 1 }, { unique: true });

export const AnalyticsEventProcessed = mongoose.model('AnalyticsEventProcessed', analyticsEventProcessedSchema);
