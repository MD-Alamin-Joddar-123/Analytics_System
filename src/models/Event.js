import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { SUPPORTED_EVENTS, PROCESSING_STATUSES } from '../constants/eventTypes.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { PAYMENT_STATUSES } from '../constants/orderStatuses.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

const itemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, trim: true, maxlength: 200 },
    name: { type: String, trim: true, maxlength: 500 },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    eventName: { type: String, required: true, enum: SUPPORTED_EVENTS },
    eventVersion: { type: String, default: '1', trim: true, maxlength: 20 },
    eventId: { type: String, required: true, trim: true },
    timestamp: { type: Date, required: true },
    receivedAt: { type: Date, required: true },

    url: { type: String, trim: true, maxlength: 2048 },
    path: { type: String, trim: true, maxlength: 500 },
    title: { type: String, trim: true, maxlength: 500 },
    referrer: { type: String, trim: true, maxlength: 2048 },

    anonymousId: { type: String, trim: true, maxlength: 128 },
    sessionId: { type: String, trim: true, maxlength: 128 },
    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor' },
    sessionObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },

    userAgent: { type: String, trim: true, maxlength: 500 },
    language: { type: String, trim: true, maxlength: 35 },
    screenWidth: { type: Number, min: 0, max: 20000 },
    screenHeight: { type: Number, min: 0, max: 20000 },
    timezone: { type: String, trim: true, maxlength: 100 },


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
      cartId: { type: String, trim: true, maxlength: 200 },
      checkoutId: { type: String, trim: true, maxlength: 200 },
      subtotal: { type: Number, min: 0 },
      discount: { type: Number, min: 0 },
      shipping: { type: Number, min: 0 },
      tax: { type: Number, min: 0 },
      total: { type: Number, min: 0 },
      paymentStatus: { type: String, enum: PAYMENT_STATUSES },
    },

    processingStatus: {
      type: String,
      enum: PROCESSING_STATUSES,
      default: 'pending',
    },
    processingAttempts: { type: Number, default: 0, min: 0 },
    lastProcessingAttemptAt: { type: Date },
    processedAt: { type: Date },
    lastProcessingError: { type: String, maxlength: 1000 },
  },
  baseSchemaOptions
);

eventSchema.index({ websiteId: 1, eventId: 1 }, { unique: true });
eventSchema.index({ websiteId: 1, timestamp: -1 });
eventSchema.index({ websiteId: 1, eventName: 1, timestamp: -1 });
eventSchema.index({ processingStatus: 1, receivedAt: 1 });

export const Event = mongoose.model('Event', eventSchema);
