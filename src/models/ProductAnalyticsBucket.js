import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { SUPPORTED_GRANULARITIES } from '../constants/analyticsGranularity.js';

const productAnalyticsBucketSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    productId: { type: String, required: true, trim: true, maxlength: 200 },
    productNameSnapshot: { type: String, trim: true, maxlength: 500 },

    granularity: { type: String, required: true, enum: SUPPORTED_GRANULARITIES },
    bucket: { type: Date, required: true },

    productViews: { type: Number, default: 0, min: 0 },
    addToCarts: { type: Number, default: 0, min: 0 },
    removeFromCarts: { type: Number, default: 0, min: 0 },
    unitsSold: { type: Number, default: 0, min: 0 },
    orders: { type: Number, default: 0, min: 0 },
    revenueMinor: { type: Number, default: 0, min: 0 },
  },
  baseSchemaOptions
);

productAnalyticsBucketSchema.index(
  { websiteId: 1, productId: 1, granularity: 1, bucket: 1 },
  { unique: true }
);

export const ProductAnalyticsBucket = mongoose.model('ProductAnalyticsBucket', productAnalyticsBucketSchema);
