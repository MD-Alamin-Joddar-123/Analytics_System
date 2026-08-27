import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

const orderItemSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },

    externalProductId: { type: String, required: true, trim: true, maxlength: 200 },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },

    productName: { type: String, trim: true, maxlength: 500 },
    sku: { type: String, trim: true, maxlength: 200 },

    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, min: 0 },

    currency: { type: String, required: true, uppercase: true, trim: true, enum: CURRENCY_ENUM },
  },
  baseSchemaOptions
);

orderItemSchema.index({ websiteId: 1, orderId: 1, externalProductId: 1 });

export const OrderItem = mongoose.model('OrderItem', orderItemSchema);
