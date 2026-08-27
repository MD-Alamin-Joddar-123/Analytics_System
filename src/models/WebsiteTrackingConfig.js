import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { DETECTION_MODES, DEFAULT_DETECTION_MODE, PRODUCT_ID_SOURCES, DEFAULT_PRODUCT_ID_SOURCE } from '../constants/trackingConfig.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

const websiteTrackingConfigSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },

    detectionMode: { type: String, enum: DETECTION_MODES, default: DEFAULT_DETECTION_MODE },

    productUrlPattern: { type: String, trim: true, maxlength: 500 },

    productIdSource: { type: String, enum: PRODUCT_ID_SOURCES, default: DEFAULT_PRODUCT_ID_SOURCE },
    productIdSelector: {
      type: String,
      trim: true,
      maxlength: 500,
      required: function isSelectorSourced() {
        return this.productIdSource === 'selector';
      },
    },
    productNameSelector: { type: String, trim: true, maxlength: 500 },
    productPriceSelector: { type: String, trim: true, maxlength: 500 },
    productPriceRegex: { type: String, trim: true, maxlength: 300 },

    orderTriggerUrlPattern: { type: String, trim: true, maxlength: 500 },

    orderIdSelector: { type: String, trim: true, maxlength: 500 },
    orderIdRegex: { type: String, trim: true, maxlength: 300 },
    orderTotalSelector: { type: String, trim: true, maxlength: 500 },
    orderTotalRegex: { type: String, trim: true, maxlength: 300 },
    orderCurrency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },

    orderItemContainerSelector: { type: String, trim: true, maxlength: 500 },
    orderItemIdSelector: { type: String, trim: true, maxlength: 500 },
    orderItemNameSelector: { type: String, trim: true, maxlength: 500 },
    orderItemPriceSelector: { type: String, trim: true, maxlength: 500 },
    orderItemQtySelector: { type: String, trim: true, maxlength: 500 },

    checkoutTriggerUrlPattern: { type: String, trim: true, maxlength: 500 },
    checkoutTotalSelector: { type: String, trim: true, maxlength: 500 },
    checkoutTotalRegex: { type: String, trim: true, maxlength: 300 },
    checkoutItemContainerSelector: { type: String, trim: true, maxlength: 500 },
    checkoutItemIdSelector: { type: String, trim: true, maxlength: 500 },
    checkoutItemNameSelector: { type: String, trim: true, maxlength: 500 },
    checkoutItemPriceSelector: { type: String, trim: true, maxlength: 500 },
    checkoutItemQtySelector: { type: String, trim: true, maxlength: 500 },

    addToCartSelector: { type: String, trim: true, maxlength: 500 },
  },
  baseSchemaOptions
);

websiteTrackingConfigSchema.index({ websiteId: 1 }, { unique: true });

export const WebsiteTrackingConfig = mongoose.model('WebsiteTrackingConfig', websiteTrackingConfigSchema);
