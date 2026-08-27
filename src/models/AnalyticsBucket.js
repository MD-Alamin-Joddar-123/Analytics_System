import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { SUPPORTED_GRANULARITIES } from '../constants/analyticsGranularity.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

const analyticsBucketSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    granularity: { type: String, required: true, enum: SUPPORTED_GRANULARITIES },
    bucket: { type: Date, required: true },

    currency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },

    pageViews: { type: Number, default: 0, min: 0 },
    uniqueVisitors: { type: Number, default: 0, min: 0 },
    uniqueSessions: { type: Number, default: 0, min: 0 },

    productViews: { type: Number, default: 0, min: 0 },
    addToCarts: { type: Number, default: 0, min: 0 },
    removeFromCarts: { type: Number, default: 0, min: 0 },

    cartsCreated: { type: Number, default: 0, min: 0 },
    cartItems: { type: Number, default: 0, min: 0 },
    cartQuantity: { type: Number, default: 0, min: 0 },
    cartValueMinor: { type: Number, default: 0, min: 0 },

    checkoutStarted: { type: Number, default: 0, min: 0 },
    checkoutCompleted: { type: Number, default: 0, min: 0 },

    orders: { type: Number, default: 0, min: 0 },
    unitsSold: { type: Number, default: 0, min: 0 },
    grossRevenueMinor: { type: Number, default: 0, min: 0 },
    refundedAmountMinor: { type: Number, default: 0, min: 0 },
    netRevenueMinor: { type: Number, default: 0 },
  },
  baseSchemaOptions
);

analyticsBucketSchema.index({ websiteId: 1, granularity: 1, bucket: 1 }, { unique: true });

export const AnalyticsBucket = mongoose.model('AnalyticsBucket', analyticsBucketSchema);
