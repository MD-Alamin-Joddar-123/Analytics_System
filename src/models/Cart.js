import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

// Represents the current/observed state of a cart, maintained
// incrementally as add_to_cart/remove_from_cart events arrive (§7/§24) —
// itemCount/subtotal are $inc'd alongside each CartItem change, not
// recomputed by summing CartItems on every request (that would mean a
// query per event, which Phase 6 §36 explicitly rules out for ingestion).
// A known, accepted tradeoff of that approach: under a pathological
// concurrent-request interleaving, these aggregates could in principle
// drift slightly from the true sum of CartItems — see cart.service.js.
const cartSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },

    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor' },
    anonymousId: { type: String, trim: true, maxlength: 128 },
    sessionId: { type: String, trim: true, maxlength: 128 },

    // The customer's own cart identifier — NOT assumed globally unique on
    // its own (§7); uniqueness is only guaranteed within a website.
    cartId: { type: String, required: true, trim: true, maxlength: 200 },

    currency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },
    itemCount: { type: Number, default: 0, min: 0 }, // total unit quantity across all CartItems, not distinct product count
    subtotal: { type: Number, default: 0, min: 0 }, // integer minor units

    lastUpdatedAt: { type: Date, required: true },
  },
  baseSchemaOptions
);

// Primary identity constraint (Phase 6 §7).
cartSchema.index({ websiteId: 1, cartId: 1 }, { unique: true });

export const Cart = mongoose.model('Cart', cartSchema);
