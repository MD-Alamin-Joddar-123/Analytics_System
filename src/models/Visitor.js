import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';

// Privacy note (Phase 5 §4/§30): identity is websiteId + anonymousId ONLY.
// Never IP, email, phone, password, or a browser fingerprint — see
// docs/DATABASE_ARCHITECTURE.md "Phase 5: Visitor & Session" for the full
// rationale. The same anonymousId on two different websites is two
// different visitors; anonymousId alone is never a global identity.
const visitorSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    anonymousId: { type: String, required: true, trim: true, maxlength: 128 },

    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },

    // Public sessionId strings (not ObjectIds) — consistent with how
    // Session identifies itself (see Session model). Set once (creation)
    // and on every subsequent accepted event, respectively.
    firstSessionId: { type: String, trim: true, maxlength: 128 },
    lastSessionId: { type: String, trim: true, maxlength: 128 },

    sessionCount: { type: Number, default: 0, min: 0 },
    eventCount: { type: Number, default: 0, min: 0 },

    firstUrl: { type: String, trim: true, maxlength: 2048 },
    lastUrl: { type: String, trim: true, maxlength: 2048 },
    firstReferrer: { type: String, trim: true, maxlength: 2048 },
    lastReferrer: { type: String, trim: true, maxlength: 2048 },

    // Device/context "as last observed" — refreshed on every accepted
    // event, same spirit as lastUrl/lastReferrer. Not fingerprinting: this
    // is the same coarse, already-collected context Phase 4 stores on the
    // event itself, just mirrored onto the visitor for convenience.
    userAgent: { type: String, trim: true, maxlength: 500 },
    language: { type: String, trim: true, maxlength: 35 },
    timezone: { type: String, trim: true, maxlength: 100 },
    screenWidth: { type: Number, min: 0, max: 20000 },
    screenHeight: { type: Number, min: 0, max: 20000 },
  },
  baseSchemaOptions
);

// Primary identity constraint (Phase 5 §5): one visitor per website per
// anonymousId, never a global anonymousId identity.
visitorSchema.index({ websiteId: 1, anonymousId: 1 }, { unique: true });
visitorSchema.index({ websiteId: 1, lastSeenAt: -1 });
visitorSchema.index({ websiteId: 1, createdAt: -1 });

export const Visitor = mongoose.model('Visitor', visitorSchema);
