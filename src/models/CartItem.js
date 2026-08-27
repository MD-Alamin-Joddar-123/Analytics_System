import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

const cartItemSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    cartId: { type: String, required: true, trim: true, maxlength: 200 },

    externalProductId: { type: String, required: true, trim: true, maxlength: 200 },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },

    productName: { type: String, trim: true, maxlength: 500 },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, trim: true, enum: CURRENCY_ENUM },
  },
  baseSchemaOptions
);

cartItemSchema.index({ websiteId: 1, cartId: 1, externalProductId: 1 }, { unique: true });

export const CartItem = mongoose.model('CartItem', cartItemSchema);
