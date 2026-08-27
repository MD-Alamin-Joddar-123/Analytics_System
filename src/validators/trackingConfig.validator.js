import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { isValidWebsiteId } from '../utils/websiteId.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import {
  DETECTION_MODES,
  DEFAULT_DETECTION_MODE,
  PRODUCT_ID_SOURCES,
  DEFAULT_PRODUCT_ID_SOURCE,
} from '../constants/trackingConfig.js';

const SELECTOR_MAX_LENGTH = 500;
const REGEX_MAX_LENGTH = 300;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readOptionalSelector(body, field) {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw ApiError.badRequest(`${field} must be a string.`, ErrorCodes.VALIDATION_ERROR);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > SELECTOR_MAX_LENGTH) {
    throw ApiError.badRequest(`${field} must be at most ${SELECTOR_MAX_LENGTH} characters.`, ErrorCodes.VALIDATION_ERROR);
  }
  return trimmed;
}

function readOptionalRegex(body, field) {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw ApiError.badRequest(`${field} must be a string.`, ErrorCodes.VALIDATION_ERROR);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > REGEX_MAX_LENGTH) {
    throw ApiError.badRequest(`${field} must be at most ${REGEX_MAX_LENGTH} characters.`, ErrorCodes.VALIDATION_ERROR);
  }
  try {
    new RegExp(trimmed);
  } catch {
    throw ApiError.badRequest(`${field} is not a valid regular expression.`, ErrorCodes.VALIDATION_ERROR);
  }
  return trimmed;
}

export function validateTrackingConfigWebsiteIdParam(req, res, next) {
  const { websiteId } = req.params;
  if (!isValidWebsiteId(websiteId)) {
    return next(ApiError.badRequest('Invalid website id.', ErrorCodes.INVALID_WEBSITE_ID));
  }
  next();
}

export function validateTrackingConfigBody(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const validated = {};

    const detectionMode = body.detectionMode === undefined ? DEFAULT_DETECTION_MODE : body.detectionMode;
    if (!DETECTION_MODES.includes(detectionMode)) {
      throw ApiError.badRequest(`detectionMode must be one of: ${DETECTION_MODES.join(', ')}.`, ErrorCodes.VALIDATION_ERROR);
    }
    validated.detectionMode = detectionMode;

    const productIdSource = body.productIdSource === undefined ? DEFAULT_PRODUCT_ID_SOURCE : body.productIdSource;
    if (!PRODUCT_ID_SOURCES.includes(productIdSource)) {
      throw ApiError.badRequest(`productIdSource must be one of: ${PRODUCT_ID_SOURCES.join(', ')}.`, ErrorCodes.VALIDATION_ERROR);
    }
    validated.productIdSource = productIdSource;

    const productUrlPattern = readOptionalSelector(body, 'productUrlPattern');
    if (productUrlPattern !== undefined) validated.productUrlPattern = productUrlPattern;

    const productIdSelector = readOptionalSelector(body, 'productIdSelector');
    if (productIdSource === 'selector' && !isNonEmptyString(productIdSelector)) {
      throw ApiError.badRequest(
        'productIdSelector is required when productIdSource is "selector".',
        ErrorCodes.VALIDATION_ERROR
      );
    }
    if (productIdSelector !== undefined) validated.productIdSelector = productIdSelector;

    const productNameSelector = readOptionalSelector(body, 'productNameSelector');
    if (productNameSelector !== undefined) validated.productNameSelector = productNameSelector;

    const productPriceSelector = readOptionalSelector(body, 'productPriceSelector');
    if (productPriceSelector !== undefined) validated.productPriceSelector = productPriceSelector;

    const productPriceRegex = readOptionalRegex(body, 'productPriceRegex');
    if (productPriceRegex !== undefined) validated.productPriceRegex = productPriceRegex;

    const orderTriggerUrlPattern = readOptionalSelector(body, 'orderTriggerUrlPattern');
    if (orderTriggerUrlPattern !== undefined) validated.orderTriggerUrlPattern = orderTriggerUrlPattern;

    const orderIdSelector = readOptionalSelector(body, 'orderIdSelector');
    if (orderIdSelector !== undefined) validated.orderIdSelector = orderIdSelector;

    const orderIdRegex = readOptionalRegex(body, 'orderIdRegex');
    if (orderIdRegex !== undefined) validated.orderIdRegex = orderIdRegex;

    const orderTotalSelector = readOptionalSelector(body, 'orderTotalSelector');
    if (orderTotalSelector !== undefined) validated.orderTotalSelector = orderTotalSelector;

    const orderTotalRegex = readOptionalRegex(body, 'orderTotalRegex');
    if (orderTotalRegex !== undefined) validated.orderTotalRegex = orderTotalRegex;

    if (body.orderCurrency !== undefined && body.orderCurrency !== null && body.orderCurrency !== '') {
      if (typeof body.orderCurrency !== 'string') {
        throw ApiError.badRequest('orderCurrency must be a string.', ErrorCodes.VALIDATION_ERROR);
      }
      const normalized = body.orderCurrency.trim().toUpperCase();
      if (!CURRENCY_CODES.has(normalized)) {
        throw ApiError.badRequest('orderCurrency must be a valid ISO 4217 code (e.g. "USD").', ErrorCodes.VALIDATION_ERROR);
      }
      validated.orderCurrency = normalized;
    }

    const orderItemContainerSelector = readOptionalSelector(body, 'orderItemContainerSelector');
    if (orderItemContainerSelector !== undefined) validated.orderItemContainerSelector = orderItemContainerSelector;

    const orderItemIdSelector = readOptionalSelector(body, 'orderItemIdSelector');
    if (orderItemIdSelector !== undefined) validated.orderItemIdSelector = orderItemIdSelector;

    const orderItemNameSelector = readOptionalSelector(body, 'orderItemNameSelector');
    if (orderItemNameSelector !== undefined) validated.orderItemNameSelector = orderItemNameSelector;

    const orderItemPriceSelector = readOptionalSelector(body, 'orderItemPriceSelector');
    if (orderItemPriceSelector !== undefined) validated.orderItemPriceSelector = orderItemPriceSelector;

    const orderItemQtySelector = readOptionalSelector(body, 'orderItemQtySelector');
    if (orderItemQtySelector !== undefined) validated.orderItemQtySelector = orderItemQtySelector;

    const addToCartSelector = readOptionalSelector(body, 'addToCartSelector');
    if (addToCartSelector !== undefined) validated.addToCartSelector = addToCartSelector;

    const checkoutTriggerUrlPattern = readOptionalSelector(body, 'checkoutTriggerUrlPattern');
    if (checkoutTriggerUrlPattern !== undefined) validated.checkoutTriggerUrlPattern = checkoutTriggerUrlPattern;

    const checkoutTotalSelector = readOptionalSelector(body, 'checkoutTotalSelector');
    if (checkoutTotalSelector !== undefined) validated.checkoutTotalSelector = checkoutTotalSelector;

    const checkoutTotalRegex = readOptionalRegex(body, 'checkoutTotalRegex');
    if (checkoutTotalRegex !== undefined) validated.checkoutTotalRegex = checkoutTotalRegex;

    const checkoutItemContainerSelector = readOptionalSelector(body, 'checkoutItemContainerSelector');
    if (checkoutItemContainerSelector !== undefined) validated.checkoutItemContainerSelector = checkoutItemContainerSelector;

    const checkoutItemIdSelector = readOptionalSelector(body, 'checkoutItemIdSelector');
    if (checkoutItemIdSelector !== undefined) validated.checkoutItemIdSelector = checkoutItemIdSelector;

    const checkoutItemNameSelector = readOptionalSelector(body, 'checkoutItemNameSelector');
    if (checkoutItemNameSelector !== undefined) validated.checkoutItemNameSelector = checkoutItemNameSelector;

    const checkoutItemPriceSelector = readOptionalSelector(body, 'checkoutItemPriceSelector');
    if (checkoutItemPriceSelector !== undefined) validated.checkoutItemPriceSelector = checkoutItemPriceSelector;

    const checkoutItemQtySelector = readOptionalSelector(body, 'checkoutItemQtySelector');
    if (checkoutItemQtySelector !== undefined) validated.checkoutItemQtySelector = checkoutItemQtySelector;

    req.validated = validated;
    next();
  } catch (error) {
    next(error);
  }
}
