import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';

const visitorSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    anonymousId: { type: String, required: true, trim: true, maxlength: 128 },

    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },

    firstSessionId: { type: String, trim: true, maxlength: 128 },
    lastSessionId: { type: String, trim: true, maxlength: 128 },

    sessionCount: { type: Number, default: 0, min: 0 },
    eventCount: { type: Number, default: 0, min: 0 },

    firstUrl: { type: String, trim: true, maxlength: 2048 },
    lastUrl: { type: String, trim: true, maxlength: 2048 },
    firstReferrer: { type: String, trim: true, maxlength: 2048 },
    lastReferrer: { type: String, trim: true, maxlength: 2048 },

    userAgent: { type: String, trim: true, maxlength: 500 },
    language: { type: String, trim: true, maxlength: 35 },
    timezone: { type: String, trim: true, maxlength: 100 },
    screenWidth: { type: Number, min: 0, max: 20000 },
    screenHeight: { type: Number, min: 0, max: 20000 },
  },
  baseSchemaOptions
);

visitorSchema.index({ websiteId: 1, anonymousId: 1 }, { unique: true });
visitorSchema.index({ websiteId: 1, lastSeenAt: -1 });
visitorSchema.index({ websiteId: 1, createdAt: -1 });

export const Visitor = mongoose.model('Visitor', visitorSchema);
