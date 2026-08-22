import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { ORDER_STATUSES, PAYMENT_STATUSES, FULFILLMENT_STATUSES } from '../constants/orderStatuses.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

// Identity is websiteId + externalOrderId (§5) — the customer's own order
// id, never our _id. Every monetary field is an integer in minor units
// (src/utils/money.js). No payment card data, CVV, passwords, or auth
// tokens are ever fields here — see §5/§30 and docs/DATABASE_ARCHITECTURE.md.
//
// `total` is the canonical gross order amount (§13); future phases compute
// gross/net revenue, refunds, and AOV FROM it — Phase 6 does not calculate
// any of that itself.
//
// orderCreatedAt and purchasedAt are both set once, at first creation, to
// the same value (the triggering purchase event's effective timestamp):
// Phase 6's event contract doesn't yet provide a distinct "order created
// in the client's system" signal separate from "we observed a purchase",
// so there's nothing to meaningfully differentiate them by yet. Both
// fields exist now so a future event field (e.g. a client-reported order
// creation time that precedes payment) can populate orderCreatedAt
// differently without a schema change.
const orderSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    externalOrderId: { type: String, required: true, trim: true, maxlength: 200 },

    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor' },
    anonymousId: { type: String, trim: true, maxlength: 128 },
    sessionId: { type: String, trim: true, maxlength: 128 },

    orderStatus: { type: String, enum: ORDER_STATUSES, default: 'pending' },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    fulfillmentStatus: { type: String, enum: FULFILLMENT_STATUSES, default: 'unfulfilled' },

    currency: { type: String, required: true, uppercase: true, trim: true, enum: CURRENCY_ENUM },
    subtotal: { type: Number, min: 0 }, // integer minor units
    discount: { type: Number, min: 0 },
    shipping: { type: Number, min: 0 },
    tax: { type: Number, min: 0 },
    total: { type: Number, required: true, min: 0 }, // canonical gross amount
    refundedAmount: { type: Number, default: 0, min: 0 },

    orderCreatedAt: { type: Date, required: true },
    purchasedAt: { type: Date, required: true },
  },
  baseSchemaOptions
);

// Primary identity + idempotency constraint (Phase 6 §5/§12): the same
// externalOrderId can never produce two Order documents, even under a
// concurrent duplicate-purchase race — see order.service.js.
orderSchema.index({ websiteId: 1, externalOrderId: 1 }, { unique: true });
// Reserved for future revenue-report queries (explicitly not implemented
// this phase) — not queried by the event pipeline itself.
orderSchema.index({ websiteId: 1, purchasedAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
