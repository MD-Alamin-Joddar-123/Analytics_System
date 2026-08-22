import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { PRODUCT_STATUSES } from '../constants/orderStatuses.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

// A Product is upserted from commerce events (product_view, add_to_cart,
// checkout/purchase line items) — there is no separate product sync API in
// Phase 6 (§4). Identity is websiteId + externalProductId; externalProductId
// is the customer's own catalog id (Shopify id, WooCommerce id, a Django
// UUID, a plain SKU string — never assumed numeric), never our MongoDB
// _id. price is stored in integer minor units — see src/utils/money.js.
const productSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    externalProductId: { type: String, required: true, trim: true, maxlength: 200 },

    name: { type: String, trim: true, maxlength: 500 },
    sku: { type: String, trim: true, maxlength: 200 },
    category: { type: String, trim: true, maxlength: 200 },
    brand: { type: String, trim: true, maxlength: 200 },

    price: { type: Number, min: 0 }, // integer minor units; last known price
    currency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },

    status: { type: String, enum: PRODUCT_STATUSES, default: 'active' },

    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  baseSchemaOptions
);

// Primary identity constraint (Phase 6 §3): one product per website per
// externalProductId. Website A's product "123" and Website B's product
// "123" are unrelated documents.
productSchema.index({ websiteId: 1, externalProductId: 1 }, { unique: true });

export const Product = mongoose.model('Product', productSchema);
