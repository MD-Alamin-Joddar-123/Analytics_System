import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

const MAX_URL_LENGTH = 2048;

// A single top-level path segment that's a generic category/collection
// word — "please paste ONE PRODUCT's URL" almost always means at least
// two segments (a category/prefix + the item itself, e.g.
// "/products/iphone-15"). Checked before ever fetching anything: no
// point spending a network round trip (and the SSRF-fetch's own cost) on
// a URL shape that's already a clear listing-page signal. A single-
// segment slug that ISN'T one of these generic words (e.g.
// "/iphone-15-pro-max") is left alone — plenty of real sites route a
// single product that way, and rejecting on segment count alone would be
// a false positive.
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
  if (segments.length === 0) return true; // bare root — never a single product
  if (segments.length === 1 && GENERIC_LISTING_WORDS.has(segments[0].toLowerCase())) return true;
  return false;
}

// Syntax-only validation — "is this even a URL." The real SSRF defense
// (is it safe to actually CONNECT to) lives entirely in
// src/utils/ssrfSafeFetch.js, run later at fetch time; duplicating any of
// that logic here would just be two places that could drift out of sync.
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
