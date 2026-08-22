import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';

const sessionSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    // Public identifier — client-supplied (if the SDK persists one) or
    // server-generated otherwise (session.service.js). Deliberately NOT
    // the MongoDB _id (Phase 5 §7): the browser-facing session identity
    // and the internal document id are different things for the same
    // reason websiteId and Website._id are — see Phase 3's rationale in
    // docs/DATABASE_ARCHITECTURE.md, which applies identically here.
    sessionId: { type: String, required: true, trim: true, maxlength: 128 },
    anonymousId: { type: String, required: true, trim: true, maxlength: 128 },
    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor', required: true },

    startedAt: { type: Date, required: true },
    lastActivityAt: { type: Date, required: true },
    // Set when the system later determines this session expired (the next
    // event for this visitor either continues an active session or, on
    // finding this one past the inactivity timeout, marks it ended before
    // starting a new one). No background worker sweeps for this — see
    // Phase 5 §18.
    endedAt: { type: Date },

    eventCount: { type: Number, default: 0, min: 0 },
    pageViewCount: { type: Number, default: 0, min: 0 },

    // landingPage: the page/path of the event that started this session
    // (whatever event type it happened to be). exitPage: the page of the
    // most recent page_view specifically — updated only on page_view
    // events, so it always reflects the last known page, not the last
    // event of any kind (e.g. a trailing add_to_cart doesn't change it).
    landingPage: { type: String, trim: true, maxlength: 2048 },
    exitPage: { type: String, trim: true, maxlength: 2048 },
    entryReferrer: { type: String, trim: true, maxlength: 2048 },

    // Device/context as observed when the session started. Unlike Visitor,
    // this is not refreshed per-event — a session is short-lived enough
    // that "as captured at session start" is the meaningful value.
    userAgent: { type: String, trim: true, maxlength: 500 },
    language: { type: String, trim: true, maxlength: 35 },
    timezone: { type: String, trim: true, maxlength: 100 },
    screenWidth: { type: Number, min: 0, max: 20000 },
    screenHeight: { type: Number, min: 0, max: 20000 },
  },
  baseSchemaOptions
);

// Primary identity constraint (Phase 5 §7/§26): one session document can
// ever hold a given (websiteId, sessionId) pair — permanently, even after
// the session expires. This is why an expired continuation gets a
// freshly-generated sessionId rather than reusing the old string; see
// session.service.js.
sessionSchema.index({ websiteId: 1, sessionId: 1 }, { unique: true });
sessionSchema.index({ websiteId: 1, anonymousId: 1, lastActivityAt: -1 });
sessionSchema.index({ websiteId: 1, startedAt: -1 });

export const Session = mongoose.model('Session', sessionSchema);
