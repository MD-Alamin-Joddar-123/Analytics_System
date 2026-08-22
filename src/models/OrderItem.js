import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

// A purchase-time SNAPSHOT of one line item — critical historical
// preservation (§6). unitPrice/productName/sku are copied from the event
// at the moment the order was first recorded and are never refreshed from
// the live Product document afterward, so a later price change on the
// Product does not retroactively alter historical order data (e.g. an
// order placed when the product cost 850 must always show unitPrice: 850,
// even if the product is priced at 1000 today).
//
// orderId is the internal reference to the Order document (an ObjectId),
// not a duplicate of Order.externalOrderId — this is the one field in
// this model that IS a resolved reference rather than a raw external id,
// since every OrderItem inherently belongs to exactly one Order document
// we just created/found.
const orderItemSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },

    externalProductId: { type: String, required: true, trim: true, maxlength: 200 },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // resolved reference, may be absent

    productName: { type: String, trim: true, maxlength: 500 },
    sku: { type: String, trim: true, maxlength: 200 },

    unitPrice: { type: Number, required: true, min: 0 }, // integer minor units, AS PURCHASED
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, min: 0 }, // unitPrice * quantity, integer minor units
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, min: 0 }, // subtotal - discount

    currency: { type: String, required: true, uppercase: true, trim: true, enum: CURRENCY_ENUM },
  },
  baseSchemaOptions
);

// Not unique (Phase 6 §31 lists this compound index for OrderItem without
// the "→ unique" suffix every other model's identity index has) — an
// order legitimately could carry more than one line for the same
// externalProductId (e.g. distinct variants tracked under one base
// product id by some platform). This index exists for query efficiency
// ("this order's line items"), not as an identity constraint.
orderItemSchema.index({ websiteId: 1, orderId: 1, externalProductId: 1 });

export const OrderItem = mongoose.model('OrderItem', orderItemSchema);
