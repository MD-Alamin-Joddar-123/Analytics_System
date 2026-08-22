import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { SUPPORTED_GRANULARITIES } from '../constants/analyticsGranularity.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

// One pre-aggregated statistics document per (websiteId, granularity,
// bucket) — the website-level rollup all core metrics land in (Phase 8
// §6). `bucket` is always a UTC-truncated Date (the bucket's START), never
// a locally-timezoned value — see docs/ANALYTICS_ARCHITECTURE.md §16 for
// the full UTC/timezone strategy and why website timezone is applied only
// by future reporting logic, never stored here.
//
// Every counter is an integer, updated exclusively via atomic $inc
// (analytics.repository.js) — never read-modify-written in JavaScript.
// Monetary counters are integer minor units (src/utils/money.js), never
// floats. Derived metrics (AOV, conversion rates) are deliberately NOT
// stored here — see §15/§16: they're computed from these raw counters at
// reporting time to avoid accumulating floating-point rounding error.
const analyticsBucketSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    granularity: { type: String, required: true, enum: SUPPORTED_GRANULARITIES },
    bucket: { type: Date, required: true },

    // Best-effort snapshot of the currency observed on this bucket's
    // monetary-bearing events (see analyticsAggregation.service.js) — not
    // a strict multi-currency ledger. Phase 8 does not implement currency
    // conversion (§29): every website is expected to operate in one
    // configured currency (Website.currency), so this field exists mainly
    // to carry that context forward for reporting, not to reconcile
    // mismatched currencies.
    currency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },

    // --- Page metrics ---
    pageViews: { type: Number, default: 0, min: 0 },
    uniqueVisitors: { type: Number, default: 0, min: 0 },
    uniqueSessions: { type: Number, default: 0, min: 0 },

    // --- Product metrics (website-level totals; see ProductAnalyticsBucket
    // for the per-product breakdown) ---
    productViews: { type: Number, default: 0, min: 0 },
    addToCarts: { type: Number, default: 0, min: 0 },
    removeFromCarts: { type: Number, default: 0, min: 0 },

    // --- Cart metrics --- cumulative add-to-cart ACTIVITY within this
    // bucket, not the live net cart state (docs/ANALYTICS_ARCHITECTURE.md
    // §cart-metrics) — the normalized Cart/CartItem entities remain the
    // source of truth for current cart contents.
    cartsCreated: { type: Number, default: 0, min: 0 },
    cartItems: { type: Number, default: 0, min: 0 },
    cartQuantity: { type: Number, default: 0, min: 0 },
    cartValueMinor: { type: Number, default: 0, min: 0 }, // NOT revenue — see §17

    // --- Checkout metrics ---
    checkoutStarted: { type: Number, default: 0, min: 0 },
    checkoutCompleted: { type: Number, default: 0, min: 0 },

    // --- Order / revenue metrics ---
    orders: { type: Number, default: 0, min: 0 },
    unitsSold: { type: Number, default: 0, min: 0 },
    grossRevenueMinor: { type: Number, default: 0, min: 0 },
    refundedAmountMinor: { type: Number, default: 0, min: 0 },
    netRevenueMinor: { type: Number, default: 0 }, // gross - refunded; not clamped to 0 defensively
  },
  baseSchemaOptions
);

// The bucket identity (Phase 8 §7): one document per website per
// granularity per bucket, ever. This is what makes the upsert+$inc pattern
// in analytics.repository.js safe under concurrent workers (§22/§23).
analyticsBucketSchema.index({ websiteId: 1, granularity: 1, bucket: 1 }, { unique: true });

export const AnalyticsBucket = mongoose.model('AnalyticsBucket', analyticsBucketSchema);
