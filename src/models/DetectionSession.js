import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { baseSchemaOptions } from './baseSchemaOptions.js';

// Browser-rendered-DOM Auto Detect (§"Detection Session"): one temporary,
// expiring, random-token session per detection attempt. The DASHBOARD
// creates it; the customer site's OWN tracking.js — running on the live
// page the dashboard cannot fetch server-side — reads its id from
// `?analytics_detection_session=<id>`, inspects the rendered DOM, and
// POSTs what it found back to /api/detection/result.
//
// Security posture (§Security Constraints): the session id IS the
// credential for exactly one narrow, low-value action — "submit detection
// findings for these two pre-registered URLs." It is:
//   - random: 24 crypto-random bytes hex (192 bits) — unguessable;
//   - temporary: TTL-indexed expiresAt (15 minutes) AND an explicit
//     expiry check on every read/submit, so a stale token is rejected
//     even before MongoDB's background TTL sweeper deletes the document;
//   - scoped: results are only accepted for URLs whose origin+path match
//     what the owner registered at creation time (see
//     detectionSession.service.js's normalizePageUrl);
//   - never a cookie/credential carrier: the result endpoint is mounted
//     with credentials:false CORS (app.js), so nothing ambient rides along.
export const DETECTION_SESSION_STATUSES = [
  'pending',
  'product_detecting',
  'product_completed',
  'order_detecting',
  'completed',
  'failed',
];

export const DETECTION_SESSION_TTL_MS = 15 * 60 * 1000;

const detectionSessionSchema = new mongoose.Schema(
  {
    // The credential itself. Unique index for O(1) lookup on every SDK
    // submission; generated in the schema via crypto.randomBytes so there
    // is exactly one definition of "what a session id looks like."
    sessionId: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(24).toString('hex'),
    },

    websiteId: { type: String, required: true, trim: true },
    createdByUserId: { type: String, required: true },

    // Pre-registered at creation by the authenticated owner; the ONLY URLs
    // a result may ever claim to have been detected on.
    productUrl: { type: String, trim: true },
    orderUrl: { type: String, trim: true },

    status: {
      type: String,
      enum: DETECTION_SESSION_STATUSES,
      default: 'pending',
    },

    // Raw browser-reported field maps ({ fieldName: {selector, value,
    // confidence, strategy} }), stored verbatim after shape validation —
    // interpretation/mapping into WebsiteTrackingConfig-shaped form values
    // is the DASHBOARD's job, exactly like the server-side detect route's
    // response is only a proposal the user reviews before saving.
    productResult: { type: mongoose.Schema.Types.Mixed, default: null },
    orderResult: { type: mongoose.Schema.Types.Mixed, default: null },

    failureReason: { type: String, trim: true, maxlength: 500 },

    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions
);

// MongoDB's TTL monitor deletes expired sessions on its ~60s sweep — this
// keeps the collection self-cleaning without any cron. The SERVICE also
// checks expiresAt explicitly on every access, because the sweeper's lag
// must never translate into accepting a submission on an expired token.
detectionSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
detectionSessionSchema.index({ websiteId: 1, createdAt: -1 });

export const DetectionSession = mongoose.model('DetectionSession', detectionSessionSchema);
