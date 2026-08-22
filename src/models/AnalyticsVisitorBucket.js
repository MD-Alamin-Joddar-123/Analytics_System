import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { SUPPORTED_GRANULARITIES } from '../constants/analyticsGranularity.js';

// Uniqueness marker for "this visitor has already been counted toward
// uniqueVisitors in this bucket" (Phase 8 §11/§12). One tiny document per
// (websiteId, granularity, bucket, anonymousId) — deliberately NOT an
// array field on AnalyticsBucket, which would grow unboundedly with
// traffic. The unique index IS the uniqueness guarantee: a second
// page_view from the same visitor in the same bucket fails to insert here
// (11000) and therefore never increments AnalyticsBucket.uniqueVisitors a
// second time — see visitorAnalytics.repository.js.
const analyticsVisitorBucketSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    granularity: { type: String, required: true, enum: SUPPORTED_GRANULARITIES },
    bucket: { type: Date, required: true },
    anonymousId: { type: String, required: true, trim: true, maxlength: 128 },
  },
  baseSchemaOptions
);

analyticsVisitorBucketSchema.index(
  { websiteId: 1, granularity: 1, bucket: 1, anonymousId: 1 },
  { unique: true }
);

export const AnalyticsVisitorBucket = mongoose.model('AnalyticsVisitorBucket', analyticsVisitorBucketSchema);
