import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { DETECTION_MODES, DEFAULT_DETECTION_MODE, PRODUCT_ID_SOURCES, DEFAULT_PRODUCT_ID_SOURCE } from '../constants/trackingConfig.js';

const CURRENCY_ENUM = Array.from(CURRENCY_CODES);

// Dashboard-driven, zero-template-change ecommerce detection config (§1 of
// this fix). One document per website — identity is `websiteId` (the SAME
// public tracking id every other collection is keyed by, embedded in the
// customer's `data-website-id` script attribute; see
// docs/DATABASE_ARCHITECTURE.md), NOT a second parallel "token" concept.
// Introducing a separate token here would fragment the multi-tenant
// isolation this entire system already enforces through websiteId — the
// script tag's data-website-id IS the token this config is looked up by.
//
// Selector/regex fields are stored and validated as STRINGS, never as
// native RegExp — this document travels to the browser as JSON (GET
// /api/config/:websiteId, Phase 2 of this fix), and the actual
// CSS-selector-matching/regex-execution happens client-side in the SDK,
// never on the server. This model's job is only to hold and validate the
// shape of that config, exactly like every other model here holds data,
// never business logic.
const websiteTrackingConfigSchema = new mongoose.Schema(
  {
    websiteId: { type: String, required: true, trim: true },

    // Selects which of the SDK's already-existing detection strategies
    // (see domEvents.js/jsonld.js) this website uses. 'selector_regex' is
    // this fix's new config-driven strategy; the other three name
    // strategies the SDK already implements independently, so choosing
    // them here is a routing decision, not something this schema
    // otherwise governs the shape of.
    detectionMode: { type: String, enum: DETECTION_MODES, default: DEFAULT_DETECTION_MODE },

    // --- Product detection -------------------------------------------------
    // A path pattern like "/product/:id" — matched against the current
    // page's URL by the SDK to decide "is this a product page at all,"
    // before any extraction is attempted.
    productUrlPattern: { type: String, trim: true, maxlength: 500 },

    productIdSource: { type: String, enum: PRODUCT_ID_SOURCES, default: DEFAULT_PRODUCT_ID_SOURCE },
    // Required only when the id comes from a selector rather than the URL
    // itself — there is nothing to select when productIdSource is 'url'.
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
    // A regex SOURCE pattern (e.g. "([\\d.]+)Tk" for "7995.00Tk"), applied
    // by the SDK against the selected element's text to pull the numeric
    // price out of surrounding currency-symbol/label text. Capped short —
    // a legitimate price-extraction pattern is always simple; an unusually
    // long one is itself a signal something is wrong, not a reason to
    // allow more.
    productPriceRegex: { type: String, trim: true, maxlength: 300 },

    // --- Order/purchase detection -------------------------------------------
    // A path pattern (may include a wildcard, e.g. "/order-confirmation/*")
    // identifying the order-confirmation page a purchase is reported from.
    orderTriggerUrlPattern: { type: String, trim: true, maxlength: 500 },

    orderIdSelector: { type: String, trim: true, maxlength: 500 },
    orderIdRegex: { type: String, trim: true, maxlength: 300 },
    orderTotalSelector: { type: String, trim: true, maxlength: 500 },
    orderTotalRegex: { type: String, trim: true, maxlength: 300 },
    // A FIXED value (§1: "order_currency (fixed value, e.g. BDT)"), not
    // extracted from the page — same ISO 4217 enum every other monetary
    // field in this system validates against (Order/Checkout/Product), so
    // a config-driven purchase event can never carry a currency code none
    // of the rest of the system would recognize.
    orderCurrency: { type: String, uppercase: true, trim: true, enum: CURRENCY_ENUM },

    // --- Order item detection (relative to each repeating row) -------------
    // The repeating container selector (e.g. one row per line item in an
    // order summary table) — item field selectors below are matched WITHIN
    // each matched container element, never against the whole document, so
    // "price" from one row is never paired with "quantity" from another.
    orderItemContainerSelector: { type: String, trim: true, maxlength: 500 },
    // Per-item product id — same "::attr(name)" convention as productIdSelector
    // (see trackingConfigDetection.js's parseSelector) since an item's real
    // catalog id is usually an attribute (data-product-id, an <a href>),
    // never visible text. Without this, a purchase's line items would have
    // no way to link back to the SAME product's product_view/add_to_cart
    // events for per-product revenue attribution.
    orderItemIdSelector: { type: String, trim: true, maxlength: 500 },
    orderItemNameSelector: { type: String, trim: true, maxlength: 500 },
    orderItemPriceSelector: { type: String, trim: true, maxlength: 500 },
    orderItemQtySelector: { type: String, trim: true, maxlength: 500 },

    // --- Checkout detection ------------------------------------------------
    //
    // Deliberately mirrors the order block above field-for-field, minus an
    // id: a checkout has no customer-visible number the way an order does,
    // so the SDK mints its own checkoutId and carries it through to the
    // purchase — that link is what turns "Checkout Started" into "Checkout
    // Completed" (see mapEventToBucketIncrements' checkoutJustCompleted).
    //
    // Currency is NOT repeated here; orderCurrency already states what this
    // website sells in, and a checkout in a different currency from its own
    // order page would be a bug, not a configuration.
    checkoutTriggerUrlPattern: { type: String, trim: true, maxlength: 500 },
    checkoutTotalSelector: { type: String, trim: true, maxlength: 500 },
    checkoutTotalRegex: { type: String, trim: true, maxlength: 300 },
    checkoutItemContainerSelector: { type: String, trim: true, maxlength: 500 },
    checkoutItemIdSelector: { type: String, trim: true, maxlength: 500 },
    checkoutItemNameSelector: { type: String, trim: true, maxlength: 500 },
    checkoutItemPriceSelector: { type: String, trim: true, maxlength: 500 },
    checkoutItemQtySelector: { type: String, trim: true, maxlength: 500 },

    // --- Add-to-cart (optional, click-based) --------------------------------
    // Unlike product_view/purchase (page-state, detected on load —
    // see docs/SDK_ARCHITECTURE.md's auto-fire section), add-to-cart is a
    // genuine user ACTION and stays click-driven even under config-driven
    // detection, for the same reason the existing data-attribute path
    // never auto-fires it: reporting it merely because a button exists
    // would invent carts nobody added to.
    addToCartSelector: { type: String, trim: true, maxlength: 500 },
  },
  baseSchemaOptions
);

// One config document per website (§1: "linked to website_id") — a second
// document for the same website would leave the SDK's GET
// /api/config/:websiteId with an ambiguous "which one" to serve.
websiteTrackingConfigSchema.index({ websiteId: 1 }, { unique: true });

export const WebsiteTrackingConfig = mongoose.model('WebsiteTrackingConfig', websiteTrackingConfigSchema);
