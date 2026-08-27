import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { SUPPORTED_GRANULARITIES } from '../constants/analyticsGranularity.js';

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
