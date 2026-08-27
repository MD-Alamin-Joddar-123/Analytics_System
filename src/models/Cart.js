import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

const cartSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },

    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor' },
    anonymousId: { type: String, trim: true, maxlength: 128 },
    sessionId: { type: String, trim: true, maxlength: 128 },

    cartId: { type: String, required: true, trim: true, maxlength: 200 },

    currency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },
    itemCount: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, default: 0, min: 0 },

    lastUpdatedAt: { type: Date, required: true },
  },
  baseSchemaOptions
);

cartSchema.index({ websiteId: 1, cartId: 1 }, { unique: true });

export const Cart = mongoose.model('Cart', cartSchema);
