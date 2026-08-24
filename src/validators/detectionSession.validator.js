import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

const MAX_URL_LENGTH = 2048;
const MAX_FIELDS_JSON_LENGTH = 16 * 1024;
const MAX_STRING_VALUE_LENGTH = 2000;

function invalid(message) {
  return ApiError.badRequest(message, ErrorCodes.DETECTION_SESSION_INVALID_BODY);
}

// Syntax-only http(s) URL check. Unlike the server-side detect route there
// is no SSRF surface here: nothing is ever FETCHED with this URL — it is
// only compared against what tracking.js reports having run on.
function readHttpUrl(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw invalid(`${field} must be a non-empty URL string of at most ${MAX_URL_LENGTH} characters.`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid(`${field} must be an absolute http(s) URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalid(`${field} must be an absolute http(s) URL.`);
  }
}

export function validateCreateSessionBody(req, _res, next) {
  try {
    const { websiteId, productUrl, orderUrl } = req.body ?? {};
    if (typeof websiteId !== 'string' || !websiteId.trim()) {
      throw invalid('websiteId is required.');
    }
    const hasProduct = typeof productUrl === 'string' && productUrl.length > 0;
    const hasOrder = typeof orderUrl === 'string' && orderUrl.length > 0;
    if (!hasProduct && !hasOrder) {
      throw invalid('Provide at least one of productUrl or orderUrl.');
    }
    if (hasProduct) readHttpUrl(productUrl, 'productUrl');
    if (hasOrder) readHttpUrl(orderUrl, 'orderUrl');
    next();
  } catch (error) {
    next(error);
  }
}

const VALID_STAGES = ['start', 'complete', 'fail'];
const VALID_SIDES = ['product', 'order'];
const VALID_CONFIDENCES = ['high', 'medium', 'low'];

// A field map is { fieldName: {selector?, value?, confidence?, strategy?} }
// — deliberately loose about WHICH fields exist (the browser detector
// evolves independently of this backend) but strict about shape and SIZE,
// so the Mixed-typed storage can never become an unbounded dumping ground.
function validateFieldsMap(fields, label) {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw invalid(`${label} must be an object of detected-field entries.`);
  }
  let serialized;
  try {
    serialized = JSON.stringify(fields);
  } catch {
    throw invalid(`${label} is not JSON-serializable.`);
  }
  if (serialized.length > MAX_FIELDS_JSON_LENGTH) {
    throw invalid(`${label} exceeds the ${MAX_FIELDS_JSON_LENGTH}-byte limit.`);
  }
  for (const [name, entry] of Object.entries(fields)) {
    if (typeof name !== 'string' || name.length > 100) {
      throw invalid(`${label} field names must be strings of at most 100 characters.`);
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw invalid(`${label}.${name} must be an object.`);
    }
    for (const key of ['selector', 'value', 'strategy']) {
      if (entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > MAX_STRING_VALUE_LENGTH)) {
        throw invalid(`${label}.${name}.${key} must be a string of at most ${MAX_STRING_VALUE_LENGTH} characters.`);
      }
    }
    if (entry.confidence !== undefined && !VALID_CONFIDENCES.includes(entry.confidence)) {
      throw invalid(`${label}.${name}.confidence must be one of ${VALID_CONFIDENCES.join(', ')}.`);
    }
  }
}

export function validateDetectionResultBody(req, _res, next) {
  try {
    const { sessionId, url, stage, side, fields, reason } = req.body ?? {};
    if (typeof sessionId !== 'string' || !/^[a-f0-9]{48}$/.test(sessionId)) {
      throw invalid('sessionId is required (48 hex characters).');
    }
    readHttpUrl(url, 'url');
    if (!VALID_STAGES.includes(stage)) {
      throw ApiError.badRequest(
        'stage must be one of "start", "complete", "fail".',
        ErrorCodes.DETECTION_SESSION_INVALID_STAGE
      );
    }
    if (side !== undefined && !VALID_SIDES.includes(side)) {
      throw invalid('side must be "product" or "order" when provided.');
    }
    if (stage === 'complete') {
      validateFieldsMap(fields ?? {}, 'fields');
    }
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) {
      throw invalid('reason must be a string of at most 500 characters.');
    }
    next();
  } catch (error) {
    next(error);
  }
}
