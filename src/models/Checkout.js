import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { CHECKOUT_STATUSES } from '../constants/orderStatuses.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

const checkoutSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    checkoutId: { type: String, required: true, trim: true, maxlength: 200 },

    cartId: { type: String, trim: true, maxlength: 200 },
    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor' },
    sessionId: { type: String, trim: true, maxlength: 128 },

    currency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },
    subtotal: { type: Number, min: 0 },
    discount: { type: Number, min: 0 },
    shipping: { type: Number, min: 0 },
    tax: { type: Number, min: 0 },
    total: { type: Number, min: 0 },

    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
    status: { type: String, enum: CHECKOUT_STATUSES, default: 'started' },
  },
  baseSchemaOptions
);

checkoutSchema.index({ websiteId: 1, checkoutId: 1 }, { unique: true });

export const Checkout = mongoose.model('Checkout', checkoutSchema);
