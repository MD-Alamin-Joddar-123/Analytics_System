import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { PRODUCT_STATUSES } from '../constants/orderStatuses.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

const productSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    externalProductId: { type: String, required: true, trim: true, maxlength: 200 },

    name: { type: String, trim: true, maxlength: 500 },
    sku: { type: String, trim: true, maxlength: 200 },
    category: { type: String, trim: true, maxlength: 200 },
    brand: { type: String, trim: true, maxlength: 200 },

    price: { type: Number, min: 0 },
    currency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },

    status: { type: String, enum: PRODUCT_STATUSES, default: 'active' },

    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  baseSchemaOptions
);

productSchema.index({ websiteId: 1, externalProductId: 1 }, { unique: true });

export const Product = mongoose.model('Product', productSchema);
