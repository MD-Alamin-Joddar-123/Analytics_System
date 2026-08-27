import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';

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
