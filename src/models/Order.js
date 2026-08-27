import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { ORDER_STATUSES, PAYMENT_STATUSES, FULFILLMENT_STATUSES } from '../constants/orderStatuses.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

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
    subtotal: { type: Number, min: 0 },
    discount: { type: Number, min: 0 },
    shipping: { type: Number, min: 0 },
    tax: { type: Number, min: 0 },
    total: { type: Number, required: true, min: 0 },
    refundedAmount: { type: Number, default: 0, min: 0 },

    orderCreatedAt: { type: Date, required: true },
    purchasedAt: { type: Date, required: true },
  },
  baseSchemaOptions
);

orderSchema.index({ websiteId: 1, externalOrderId: 1 }, { unique: true });
orderSchema.index({ websiteId: 1, purchasedAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
