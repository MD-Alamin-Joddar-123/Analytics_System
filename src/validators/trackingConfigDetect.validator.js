import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

const MAX_URL_LENGTH = 2048;

const GENERIC_LISTING_WORDS = new Set([
  'products',
  'product',
  'shop',
  'store',
  'catalog',
  'catalogue',
  'collections',
  'collection',
  'category',
  'categories',
  'items',
]);

function looksLikeListingUrl(parsedUrl) {
  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return true;
  if (segments.length === 1 && GENERIC_LISTING_WORDS.has(segments[0].toLowerCase())) return true;
  return false;
}

function readOptionalUrl(body, field, { rejectListingShape = false } = {}) {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
    throw ApiError.badRequest(`${field} must be a string of at most ${MAX_URL_LENGTH} characters.`, ErrorCodes.DETECT_INVALID_URL);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw ApiError.badRequest(`${field} is not a valid URL.`, ErrorCodes.DETECT_INVALID_URL);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw ApiError.badRequest(`${field} must be an http(s) URL.`, ErrorCodes.DETECT_INVALID_URL);
  }
  if (rejectListingShape && looksLikeListingUrl(parsed)) {
    throw ApiError.badRequest(
      'This looks like a category/listing URL, not a single product page. Please paste the URL of one specific product (e.g. /products/some-item-name).',
      ErrorCodes.DETECT_PRODUCT_URL_LOOKS_LIKE_LISTING
    );
  }
  return parsed.href;
}

export function validateDetectBody(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const productUrl = readOptionalUrl(body, 'productUrl', { rejectListingShape: true });
    const orderUrl = readOptionalUrl(body, 'orderUrl');
    const checkoutUrl = readOptionalUrl(body, 'checkoutUrl');

    if (!productUrl && !orderUrl && !checkoutUrl) {
      throw ApiError.badRequest(
        'At least one of productUrl, orderUrl or checkoutUrl is required.',
        ErrorCodes.DETECT_NO_URL_PROVIDED
      );
    }

    req.validated = { productUrl, orderUrl, checkoutUrl };
    next();
  } catch (error) {
    next(error);
  }
}
