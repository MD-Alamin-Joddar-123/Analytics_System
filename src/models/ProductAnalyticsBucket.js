import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { SUPPORTED_GRANULARITIES } from '../constants/analyticsGranularity.js';

// Per-product time-bucketed statistics (Phase 8 §8) — kept out of
// AnalyticsBucket so a website with many products never bloats the
// website-level document. Identity is websiteId + productId (the EXTERNAL
// product id, never Mongo _id — same rule as the Product model itself) +
// granularity + bucket.
//
// productNameSnapshot reflects whatever name was observed on the events
// that wrote to THIS bucket; it is refreshed via plain $set (never
// $setOnInsert-only) so a name correction observed later in the SAME
// bucket window is picked up, but a product rename can never retroactively
// alter an older bucket document's snapshot (§28) — the upsert filter is
// always scoped to one specific bucket, so an old bucket is structurally
// never touched again once its time window has passed.
const productAnalyticsBucketSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    productId: { type: String, required: true, trim: true, maxlength: 200 }, // external product id
    productNameSnapshot: { type: String, trim: true, maxlength: 500 },

    granularity: { type: String, required: true, enum: SUPPORTED_GRANULARITIES },
    bucket: { type: Date, required: true },

    productViews: { type: Number, default: 0, min: 0 },
    addToCarts: { type: Number, default: 0, min: 0 },
    removeFromCarts: { type: Number, default: 0, min: 0 },
    unitsSold: { type: Number, default: 0, min: 0 },
    orders: { type: Number, default: 0, min: 0 }, // count of order LINES for this product, see §8 note
    revenueMinor: { type: Number, default: 0, min: 0 },
  },
  baseSchemaOptions
);

productAnalyticsBucketSchema.index(
  { websiteId: 1, productId: 1, granularity: 1, bucket: 1 },
  { unique: true }
);

export const ProductAnalyticsBucket = mongoose.model('ProductAnalyticsBucket', productAnalyticsBucketSchema);
