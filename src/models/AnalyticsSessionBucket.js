import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { SUPPORTED_GRANULARITIES } from '../constants/analyticsGranularity.js';

// Session counterpart to AnalyticsVisitorBucket — identical strategy, keyed
// on the resolved session's sessionId instead of anonymousId (Phase 8
// §11/§12). See that model's comment for the full rationale.
const analyticsSessionBucketSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    granularity: { type: String, required: true, enum: SUPPORTED_GRANULARITIES },
    bucket: { type: Date, required: true },
    sessionId: { type: String, required: true, trim: true, maxlength: 128 },
  },
  baseSchemaOptions
);

analyticsSessionBucketSchema.index(
  { websiteId: 1, granularity: 1, bucket: 1, sessionId: 1 },
  { unique: true }
);

export const AnalyticsSessionBucket = mongoose.model('AnalyticsSessionBucket', analyticsSessionBucketSchema);
