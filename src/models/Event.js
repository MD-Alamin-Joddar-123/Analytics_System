import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { SUPPORTED_EVENTS, PROCESSING_STATUSES } from '../constants/eventTypes.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { PAYMENT_STATUSES } from '../constants/orderStatuses.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

// Line item shape shared by checkout/purchase `data.items`. `_id: false`
// because these are transient event facts, not addressable sub-resources.
const itemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, trim: true, maxlength: 200 },
    name: { type: String, trim: true, maxlength: 500 },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

// `data` is defined as an explicit, narrow set of fields (a nested path,
// not Mongoose `Mixed`) rather than an open-ended object. This is
// deliberate, layered defense-in-depth on top of the allow-list already
// enforced in event.validator.js: even if a bug in the service layer ever
// forwarded a raw client object here, Mongoose would still silently drop
// any key not listed below (e.g. password/cvv/creditCard) rather than
// persist it. None of these are individually `required` at the schema
// level — which fields are required depends on eventName, and that
// conditional business rule is enforced in the validator before a document
// ever reaches this schema.
const eventSchema = new mongoose.Schema(
  {
    // --- Core ---
    websiteId: { type: String, required: true, trim: true },
    eventName: { type: String, required: true, enum: SUPPORTED_EVENTS },
    eventVersion: { type: String, default: '1', trim: true, maxlength: 20 },
    eventId: { type: String, required: true, trim: true },
    timestamp: { type: Date, required: true }, // when the event occurred (client-reported or defaulted)
    receivedAt: { type: Date, required: true }, // when this server accepted it — always server-set

    // --- Page/context ---
    url: { type: String, trim: true, maxlength: 2048 },
    path: { type: String, trim: true, maxlength: 500 },
    title: { type: String, trim: true, maxlength: 500 },
    referrer: { type: String, trim: true, maxlength: 2048 },

    // --- Visitor/session ---
    // anonymousId/sessionId are the raw, opaque strings the client sent
    // (or omitted) — preserved unmodified for data fidelity. visitorId/
    // sessionObjectId are the resolved references to the actual Visitor/
    // Session documents (Phase 5). These CAN legitimately diverge: when a
    // client's sessionId turns out to have expired, its continuation is a
    // new Session document with a freshly-generated sessionId (see
    // session.service.js) — so sessionId here still reads exactly what
    // the client sent, while sessionObjectId points at the session this
    // event actually landed in. Both are kept for that reason. Either
    // pair may be absent (visitorId/sessionObjectId are undefined) when
    // anonymousId was missing — see event.service.js.
    anonymousId: { type: String, trim: true, maxlength: 128 },
    sessionId: { type: String, trim: true, maxlength: 128 },
    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor' },
    sessionObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },

    // --- Device/context ---
    userAgent: { type: String, trim: true, maxlength: 500 }, // from the request header, never client-body-supplied
    language: { type: String, trim: true, maxlength: 35 },
    screenWidth: { type: Number, min: 0, max: 20000 },
    screenHeight: { type: Number, min: 0, max: 20000 },
    timezone: { type: String, trim: true, maxlength: 100 },

    // Deliberately no IP/geo fields: raw IP addresses are personal data
    // under most privacy regimes, and geo-IP resolution is out of scope
    // for Phase 4. Add a coarse, purpose-specific field (e.g. a
    // CDN-derived country code) only when a later phase actually needs it
    // — don't carry an unused field "just in case".

    // --- Ecommerce data (allow-listed; shape/requiredness enforced per
    // eventName in event.validator.js before this document is built) ---
    // These are the RAW, major-unit values exactly as the client sent
    // them — the historical raw event record (Phase 4 design, unchanged
    // by Phase 6). The normalized Product/Cart/Checkout/Order/OrderItem
    // documents Phase 6 introduces store the CONVERTED integer-minor-unit
    // values instead; see src/utils/money.js.
    data: {
      productId: { type: String, trim: true, maxlength: 200 },
      name: { type: String, trim: true, maxlength: 500 },
      price: { type: Number, min: 0 },
      quantity: { type: Number, min: 1 },
      currency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },
      orderId: { type: String, trim: true, maxlength: 200 },
      revenue: { type: Number, min: 0 },
      cartValue: { type: Number, min: 0 },
      items: [itemSchema],
      // --- Phase 6 additions ---
      cartId: { type: String, trim: true, maxlength: 200 },
      checkoutId: { type: String, trim: true, maxlength: 200 },
      subtotal: { type: Number, min: 0 },
      discount: { type: Number, min: 0 },
      shipping: { type: Number, min: 0 },
      tax: { type: Number, min: 0 },
      total: { type: Number, min: 0 },
      paymentStatus: { type: String, enum: PAYMENT_STATUSES },
    },

    // --- Processing state (Phase 7) ---
    // Tracks the asynchronous Visitor/Session/Commerce processing done by
    // the worker (src/workers/event.worker.js), separate from event
    // ACCEPTANCE (persisting this document) which already happened by the
    // time these fields are ever read. State machine documented in
    // docs/QUEUE_ARCHITECTURE.md: pending -> processing -> completed, or
    // pending -> processing -> failed -> (retried) -> processing -> ...
    processingStatus: {
      type: String,
      enum: PROCESSING_STATUSES,
      default: 'pending',
    },
    processingAttempts: { type: Number, default: 0, min: 0 },
    lastProcessingAttemptAt: { type: Date },
    processedAt: { type: Date },
    // Capped length: this is a diagnostic message, not a payload dump —
    // see eventProcessing.service.js, which only ever stores `error.message`
    // from our own service-layer errors, never raw request/event data.
    lastProcessingError: { type: String, maxlength: 1000 },
  },
  baseSchemaOptions
);

// Idempotency identity (Phase 4 §8): the same event must never be counted
// twice. This unique index is the actual guarantee; the service layer's
// pre-check + duplicate-key fallback are a courtesy on top of it.
eventSchema.index({ websiteId: 1, eventId: 1 }, { unique: true });
// Supports future retrieval/debugging by website, newest first.
eventSchema.index({ websiteId: 1, timestamp: -1 });
// Supports future per-event-type queries (e.g. "all purchases for site X").
eventSchema.index({ websiteId: 1, eventName: 1, timestamp: -1 });
// Operational index (deliberately NOT websiteId-scoped, unlike every other
// index in this system): supports a future reconciliation worker scanning
// ACROSS all tenants for stuck pending/failed events (Phase 7 §21) — not
// queried by the collector or the normal worker path itself.
eventSchema.index({ processingStatus: 1, receivedAt: 1 });

export const Event = mongoose.model('Event', eventSchema);
