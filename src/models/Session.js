import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';

const sessionSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    sessionId: { type: String, required: true, trim: true, maxlength: 128 },
    anonymousId: { type: String, required: true, trim: true, maxlength: 128 },
    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor', required: true },

    startedAt: { type: Date, required: true },
    lastActivityAt: { type: Date, required: true },
    endedAt: { type: Date },

    eventCount: { type: Number, default: 0, min: 0 },
    pageViewCount: { type: Number, default: 0, min: 0 },

    landingPage: { type: String, trim: true, maxlength: 2048 },
    exitPage: { type: String, trim: true, maxlength: 2048 },
    entryReferrer: { type: String, trim: true, maxlength: 2048 },

    userAgent: { type: String, trim: true, maxlength: 500 },
    language: { type: String, trim: true, maxlength: 35 },
    timezone: { type: String, trim: true, maxlength: 100 },
    screenWidth: { type: Number, min: 0, max: 20000 },
    screenHeight: { type: Number, min: 0, max: 20000 },
  },
  baseSchemaOptions
);

sessionSchema.index({ websiteId: 1, sessionId: 1 }, { unique: true });
sessionSchema.index({ websiteId: 1, anonymousId: 1, lastActivityAt: -1 });
sessionSchema.index({ websiteId: 1, startedAt: -1 });

export const Session = mongoose.model('Session', sessionSchema);
