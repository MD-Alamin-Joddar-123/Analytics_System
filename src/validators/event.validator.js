import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { SUPPORTED_EVENTS } from '../constants/eventTypes.js';
import { isValidWebsiteId } from '../utils/websiteId.js';
import { parseEventTimestamp } from '../utils/eventTimestamp.js';
import { isValidTimezone } from '../utils/timezone.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { PAYMENT_STATUSES } from '../constants/orderStatuses.js';

const EVENT_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

const MAX_STRING_LENGTH = 500;
const MAX_URL_LENGTH = 2048;
const MAX_ID_LENGTH = 128;
// Shared cap for every customer-supplied external commerce id
// (productId, orderId, cartId, checkoutId) — Phase 6 §16: never assumed
// numeric, just a normalized string with a reasonable length limit.
const EXTERNAL_ID_MAX_LENGTH = 200;
const MAX_ITEMS = 100;
const MAX_MONEY_AMOUNT = 1_000_000_000;
const MAX_QUANTITY = 100_000;
const MAX_EVENT_VERSION_LENGTH = 20;
const MAX_LANGUAGE_LENGTH = 35;
const MAX_SCREEN_DIMENSION = 20_000;
// Reconciliation tolerance for order/checkout totals (Phase 6 §18),
// expressed in major currency units (e.g. 0.01 = one cent/paisa) to
// absorb ordinary rounding — not a loophole for genuinely wrong totals.
const TOTAL_RECONCILIATION_TOLERANCE = 0.01;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidEventData(message) {
  return ApiError.badRequest(message, ErrorCodes.INVALID_EVENT_DATA);
}

function validationError(message) {
  return ApiError.badRequest(message, ErrorCodes.VALIDATION_ERROR);
}

// --- Field-level helpers -----------------------------------------------

function readOptionalString(body, field, maxLength) {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw validationError(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) {
    throw validationError(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function readOptionalUrl(body, field, maxLength) {
  const value = readOptionalString(body, field, maxLength);
  if (value === undefined) return undefined;
  try {
    // eslint-disable-next-line no-new
    new URL(value);
  } catch {
    throw validationError(`${field} must be a valid absolute URL.`);
  }
  return value;
}

function readOptionalInteger(body, field, { min, max }) {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw validationError(`${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function readMoneyAmount(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MONEY_AMOUNT) {
    throw invalidEventData(`${fieldName} must be a non-negative number.`);
  }
  return value;
}

function readQuantity(value, fieldName = 'quantity') {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_QUANTITY) {
    throw invalidEventData(`${fieldName} must be an integer of at least 1.`);
  }
  return value;
}

function readCurrency(value) {
  if (typeof value !== 'string') {
    throw invalidEventData('currency is required.');
  }
  const normalized = value.trim().toUpperCase();
  if (!CURRENCY_CODES.has(normalized)) {
    throw invalidEventData('currency must be a valid ISO 4217 code (e.g. "USD").');
  }
  return normalized;
}

function readProductId(value) {
  if (!isNonEmptyString(value) || value.trim().length > EXTERNAL_ID_MAX_LENGTH) {
    throw invalidEventData(`productId is required and must be at most ${EXTERNAL_ID_MAX_LENGTH} characters.`);
  }
  return value.trim();
}

// Optional external-id-shaped fields within `data` (cartId, checkoutId) —
// distinct from readOptionalString, which operates on the top-level body,
// not a nested `data` object.
function readOptionalDataId(value, fieldName) {
  if (value === undefined || value === null) return undefined;
  if (!isNonEmptyString(value) || value.trim().length > EXTERNAL_ID_MAX_LENGTH) {
    throw invalidEventData(`${fieldName} must be a non-empty string of at most ${EXTERNAL_ID_MAX_LENGTH} characters.`);
  }
  return value.trim();
}

function readOptionalMoneyAmount(value, fieldName) {
  if (value === undefined || value === null) return undefined;
  return readMoneyAmount(value, fieldName);
}

function readOptionalPaymentStatus(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !PAYMENT_STATUSES.includes(value)) {
    throw invalidEventData(`paymentStatus must be one of: ${PAYMENT_STATUSES.join(', ')}.`);
  }
  return value;
}

// Order/checkout total validation policy (Phase 6 §18): only reconciled
// when the client supplies a FULL explicit breakdown (all five fields,
// including `total` itself) — a partial breakdown (e.g. just `discount`)
// is accepted without cross-checking, since there's nothing reliable to
// check it against. When all five are present, subtotal - discount +
// shipping + tax must equal total within a small rounding tolerance.
function validateTotalsConsistency({ subtotal, discount, shipping, tax, total }) {
  if ([subtotal, discount, shipping, tax, total].some((value) => value === undefined)) {
    return;
  }
  const expected = subtotal - discount + shipping + tax;
  if (Math.abs(expected - total) > TOTAL_RECONCILIATION_TOLERANCE) {
    throw invalidEventData(
      `Inconsistent totals: subtotal (${subtotal}) - discount (${discount}) + shipping (${shipping}) + tax (${tax}) = ${expected}, but total is ${total}.`
    );
  }
}

function readOptionalName(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length > MAX_STRING_LENGTH) {
    throw invalidEventData(`name must be a string of at most ${MAX_STRING_LENGTH} characters.`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readItem(rawItem, index) {
  if (!isPlainObject(rawItem)) {
    throw invalidEventData(`items[${index}] must be an object.`);
  }
  return {
    productId: readProductId(rawItem.productId),
    ...(readOptionalName(rawItem.name) !== undefined ? { name: readOptionalName(rawItem.name) } : {}),
    price: readMoneyAmount(rawItem.price, `items[${index}].price`),
    quantity: readQuantity(rawItem.quantity, `items[${index}].quantity`),
  };
}

function readItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw invalidEventData('items must be a non-empty array.');
  }
  if (rawItems.length > MAX_ITEMS) {
    throw invalidEventData(`items must contain at most ${MAX_ITEMS} entries.`);
  }
  return rawItems.map(readItem);
}

// --- Per-event `data` validators ----------------------------------------
// Each returns ONLY the fields it explicitly names — nothing from the raw
// client `data` object is ever copied through unexamined. This is the
// primary defense against a client (accidentally or otherwise) sending
// sensitive fields like passwords or card numbers: there is structurally
// no code path that would persist an unrecognized key.

function validatePageViewData() {
  // page_view carries no ecommerce data; any `data` the client sends is
  // intentionally ignored rather than persisted.
  return undefined;
}

function validateProductViewData(raw) {
  const data = isPlainObject(raw) ? raw : {};
  const result = { productId: readProductId(data.productId) };
  const name = readOptionalName(data.name);
  if (name !== undefined) result.name = name;
  if (data.price !== undefined) result.price = readMoneyAmount(data.price, 'price');
  if (data.currency !== undefined) result.currency = readCurrency(data.currency);
  return result;
}

// add_to_cart: productId/price/quantity required — unchanged from Phase 4.
// cartId is new and optional (Phase 6 §23): present, it links the action
// to a Cart/CartItem; absent, the event is still accepted, just unlinked
// (same graceful-degradation pattern as a missing anonymousId in Phase 5).
function validateAddToCartData(raw) {
  const data = isPlainObject(raw) ? raw : {};
  const result = {
    productId: readProductId(data.productId),
    price: readMoneyAmount(data.price, 'price'),
    quantity: readQuantity(data.quantity),
  };
  const name = readOptionalName(data.name);
  if (name !== undefined) result.name = name;
  if (data.currency !== undefined) result.currency = readCurrency(data.currency);
  const cartId = readOptionalDataId(data.cartId, 'cartId');
  if (cartId !== undefined) result.cartId = cartId;
  return result;
}

// remove_from_cart: productId/quantity required (unchanged). `price` was
// required in Phase 4; Phase 6's contract for this event doesn't include
// it (§23), so it's relaxed to optional here — a strictly backward-
// compatible change (any payload that satisfied the old, stricter rule
// still satisfies this one).
function validateRemoveFromCartData(raw) {
  const data = isPlainObject(raw) ? raw : {};
  const result = {
    productId: readProductId(data.productId),
    quantity: readQuantity(data.quantity),
  };
  if (data.price !== undefined) result.price = readMoneyAmount(data.price, 'price');
  const name = readOptionalName(data.name);
  if (name !== undefined) result.name = name;
  if (data.currency !== undefined) result.currency = readCurrency(data.currency);
  const cartId = readOptionalDataId(data.cartId, 'cartId');
  if (cartId !== undefined) result.cartId = cartId;
  return result;
}

// checkout: items/cartValue/currency remain required, unchanged from
// Phase 4 — existing valid payloads keep working. checkoutId, cartId, and
// a full financial breakdown (subtotal/discount/shipping/tax/total) are
// new and optional (Phase 6 §23). `total` defaults to `cartValue` when not
// explicitly supplied — they represent the same concept.
function validateCheckoutData(raw) {
  const data = isPlainObject(raw) ? raw : {};
  const result = {
    items: readItems(data.items),
    cartValue: readMoneyAmount(data.cartValue, 'cartValue'),
    currency: readCurrency(data.currency),
  };

  const checkoutId = readOptionalDataId(data.checkoutId, 'checkoutId');
  if (checkoutId !== undefined) result.checkoutId = checkoutId;
  const cartId = readOptionalDataId(data.cartId, 'cartId');
  if (cartId !== undefined) result.cartId = cartId;

  const subtotal = readOptionalMoneyAmount(data.subtotal, 'subtotal');
  const discount = readOptionalMoneyAmount(data.discount, 'discount');
  const shipping = readOptionalMoneyAmount(data.shipping, 'shipping');
  const tax = readOptionalMoneyAmount(data.tax, 'tax');
  const explicitTotal = readOptionalMoneyAmount(data.total, 'total');
  validateTotalsConsistency({ subtotal, discount, shipping, tax, total: explicitTotal });

  if (subtotal !== undefined) result.subtotal = subtotal;
  if (discount !== undefined) result.discount = discount;
  if (shipping !== undefined) result.shipping = shipping;
  if (tax !== undefined) result.tax = tax;
  result.total = explicitTotal ?? result.cartValue;

  return result;
}

// purchase: orderId/revenue/currency/items remain required, unchanged
// from Phase 4. checkoutId, a full financial breakdown, and paymentStatus
// are new and optional (Phase 6 §23). `total` defaults to `revenue` when
// not explicitly supplied.
function validatePurchaseData(raw) {
  const data = isPlainObject(raw) ? raw : {};
  if (!isNonEmptyString(data.orderId) || data.orderId.trim().length > EXTERNAL_ID_MAX_LENGTH) {
    throw invalidEventData(`orderId is required and must be at most ${EXTERNAL_ID_MAX_LENGTH} characters.`);
  }

  const result = {
    orderId: data.orderId.trim(),
    revenue: readMoneyAmount(data.revenue, 'revenue'),
    currency: readCurrency(data.currency),
    items: readItems(data.items),
  };

  const checkoutId = readOptionalDataId(data.checkoutId, 'checkoutId');
  if (checkoutId !== undefined) result.checkoutId = checkoutId;

  const subtotal = readOptionalMoneyAmount(data.subtotal, 'subtotal');
  const discount = readOptionalMoneyAmount(data.discount, 'discount');
  const shipping = readOptionalMoneyAmount(data.shipping, 'shipping');
  const tax = readOptionalMoneyAmount(data.tax, 'tax');
  const explicitTotal = readOptionalMoneyAmount(data.total, 'total');
  validateTotalsConsistency({ subtotal, discount, shipping, tax, total: explicitTotal });

  if (subtotal !== undefined) result.subtotal = subtotal;
  if (discount !== undefined) result.discount = discount;
  if (shipping !== undefined) result.shipping = shipping;
  if (tax !== undefined) result.tax = tax;
  result.total = explicitTotal ?? result.revenue;

  const paymentStatus = readOptionalPaymentStatus(data.paymentStatus);
  if (paymentStatus !== undefined) result.paymentStatus = paymentStatus;

  return result;
}

const DATA_VALIDATORS = {
  page_view: validatePageViewData,
  product_view: validateProductViewData,
  add_to_cart: validateAddToCartData,
  remove_from_cart: validateRemoveFromCartData,
  checkout: validateCheckoutData,
  purchase: validatePurchaseData,
};

// --- Top-level middleware ------------------------------------------------

export function validateCollectEvent(req, res, next) {
  try {
    const body = req.body;
    if (!isPlainObject(body)) {
      throw validationError('Malformed request body.');
    }

    if (!isNonEmptyString(body.websiteId)) {
      throw validationError('websiteId is required.');
    }
    const websiteId = body.websiteId.trim();
    if (!isValidWebsiteId(websiteId)) {
      throw ApiError.badRequest('Malformed websiteId.', ErrorCodes.INVALID_WEBSITE_ID);
    }

    if (!isNonEmptyString(body.event)) {
      throw validationError('event is required.');
    }
    const event = body.event.trim();
    if (!SUPPORTED_EVENTS.includes(event)) {
      throw ApiError.badRequest(`Unsupported event: "${event}".`, ErrorCodes.UNSUPPORTED_EVENT);
    }

    let eventId;
    if (body.eventId !== undefined && body.eventId !== null) {
      if (typeof body.eventId !== 'string' || !EVENT_ID_REGEX.test(body.eventId)) {
        throw ApiError.badRequest(
          'eventId must be 1-128 characters of letters, digits, "-", or "_".',
          ErrorCodes.INVALID_EVENT_ID
        );
      }
      eventId = body.eventId;
    }

    let timestamp;
    if (body.timestamp !== undefined && body.timestamp !== null) {
      const parsed = parseEventTimestamp(body.timestamp);
      if (!parsed.ok) {
        throw ApiError.badRequest(
          'timestamp must be a valid, not-too-far-in-the-future date.',
          ErrorCodes.INVALID_TIMESTAMP
        );
      }
      timestamp = parsed.date;
    }

    const eventVersion = readOptionalString(body, 'eventVersion', MAX_EVENT_VERSION_LENGTH);
    const url = readOptionalUrl(body, 'url', MAX_URL_LENGTH);
    const path = readOptionalString(body, 'path', MAX_STRING_LENGTH);
    const title = readOptionalString(body, 'title', MAX_STRING_LENGTH);
    // referrer is intentionally NOT format-validated as a URL: real
    // browsers/SDKs send non-URL referrer values too (empty string for
    // direct traffic, custom app schemes, etc.) — only length is capped.
    const referrer = readOptionalString(body, 'referrer', MAX_URL_LENGTH);
    const anonymousId = readOptionalString(body, 'anonymousId', MAX_ID_LENGTH);
    const sessionId = readOptionalString(body, 'sessionId', MAX_ID_LENGTH);
    const language = readOptionalString(body, 'language', MAX_LANGUAGE_LENGTH);
    const screenWidth = readOptionalInteger(body, 'screenWidth', { min: 0, max: MAX_SCREEN_DIMENSION });
    const screenHeight = readOptionalInteger(body, 'screenHeight', { min: 0, max: MAX_SCREEN_DIMENSION });

    let timezone;
    if (body.timezone !== undefined && body.timezone !== null) {
      if (!isValidTimezone(body.timezone)) {
        throw validationError('timezone must be a valid IANA time zone (e.g. "Asia/Dhaka").');
      }
      timezone = body.timezone;
    }

    const data = DATA_VALIDATORS[event](body.data);

    req.validated = {
      websiteId,
      event,
      eventId,
      timestamp,
      eventVersion,
      url,
      path,
      title,
      referrer,
      anonymousId,
      sessionId,
      language,
      screenWidth,
      screenHeight,
      timezone,
      data,
    };

    next();
  } catch (error) {
    next(error);
  }
}
