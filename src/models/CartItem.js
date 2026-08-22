import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

// One line item within a Cart. cartId here is the same external string as
// Cart.cartId (not a dereferenced Cart._id) — the identity constraint in
// §8 is stated directly in terms of websiteId + cartId + product, so
// storing the string directly lets that unique index be a straight
// compound index instead of needing a join.
const cartItemSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    cartId: { type: String, required: true, trim: true, maxlength: 200 },

    externalProductId: { type: String, required: true, trim: true, maxlength: 200 },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // resolved reference, may be absent

    productName: { type: String, trim: true, maxlength: 500 }, // as last observed, not a purchase-time snapshot (contrast OrderItem)
    unitPrice: { type: Number, required: true, min: 0 }, // integer minor units, at time of adding
    quantity: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, trim: true, enum: CURRENCY_ENUM },
  },
  baseSchemaOptions
);

// Prevents a second line item for the same product in the same cart
// (Phase 6 §8) — add_to_cart for an already-present product increments
// this document's quantity instead of inserting a duplicate.
cartItemSchema.index({ websiteId: 1, cartId: 1, externalProductId: 1 }, { unique: true });

export const CartItem = mongoose.model('CartItem', cartItemSchema);
