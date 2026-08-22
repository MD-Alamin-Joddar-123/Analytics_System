import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { normalizeDomain, isValidDomain } from '../utils/domain.js';
import { isValidTimezone } from '../utils/timezone.js';
import { CURRENCY_CODES } from '../constants/currencies.js';

const OBJECT_ID_REGEX = /^[a-f0-9]{24}$/i;
const NAME_MAX_LENGTH = 120;
// Statuses settable via PATCH. "archived" is intentionally excluded — that
// transition only happens through DELETE /api/websites/:id, which carries
// its own (idempotent) archive semantics.
const PATCHABLE_STATUSES = ['active', 'paused'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateName(name) {
  if (!isNonEmptyString(name)) {
    throw ApiError.badRequest('Name is required.', ErrorCodes.VALIDATION_ERROR);
  }
  const trimmed = name.trim();
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw ApiError.badRequest(`Name must be at most ${NAME_MAX_LENGTH} characters.`, ErrorCodes.VALIDATION_ERROR);
  }
  return trimmed;
}

function validateDomain(domain) {
  if (!isNonEmptyString(domain)) {
    throw ApiError.badRequest('Domain is required.', ErrorCodes.INVALID_DOMAIN);
  }
  const normalized = normalizeDomain(domain);
  if (!normalized || !isValidDomain(normalized)) {
    throw ApiError.badRequest('Domain is not a valid hostname.', ErrorCodes.INVALID_DOMAIN);
  }
  return normalized;
}

function validateTimezone(timezone) {
  if (!isNonEmptyString(timezone) || !isValidTimezone(timezone)) {
    throw ApiError.badRequest('Timezone must be a valid IANA time zone (e.g. "Asia/Dhaka").', ErrorCodes.VALIDATION_ERROR);
  }
  return timezone;
}

function validateCurrency(currency) {
  if (!isNonEmptyString(currency)) {
    throw ApiError.badRequest('Currency is required.', ErrorCodes.VALIDATION_ERROR);
  }
  const normalized = currency.trim().toUpperCase();
  if (!CURRENCY_CODES.has(normalized)) {
    throw ApiError.badRequest('Currency must be a valid ISO 4217 code (e.g. "USD").', ErrorCodes.VALIDATION_ERROR);
  }
  return normalized;
}

function validateStatus(status) {
  if (!PATCHABLE_STATUSES.includes(status)) {
    const allowed = PATCHABLE_STATUSES.join(', ');
    throw ApiError.badRequest(
      `Status must be one of: ${allowed}. Use DELETE to archive a website.`,
      ErrorCodes.INVALID_WEBSITE_STATUS
    );
  }
  return status;
}

// Client-supplied ownerId/websiteId/_id/createdAt/updatedAt are simply
// never read here — only the fields explicitly picked below make it into
// req.validated, so those fields have zero effect regardless of what the
// request body contains. The server is the sole source of ownerId
// (req.user.id) and websiteId (generated in the service layer).
export function validateCreateWebsite(req, res, next) {
  try {
    const body = req.body || {};

    req.validated = {
      name: validateName(body.name),
      domain: validateDomain(body.domain),
      timezone: validateTimezone(body.timezone),
      currency: validateCurrency(body.currency),
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function validateUpdateWebsite(req, res, next) {
  try {
    const body = req.body || {};
    const updates = {};

    if (body.name !== undefined) updates.name = validateName(body.name);
    if (body.domain !== undefined) updates.domain = validateDomain(body.domain);
    if (body.timezone !== undefined) updates.timezone = validateTimezone(body.timezone);
    if (body.currency !== undefined) updates.currency = validateCurrency(body.currency);
    if (body.status !== undefined) updates.status = validateStatus(body.status);

    if (Object.keys(updates).length === 0) {
      throw ApiError.badRequest('No updatable fields provided.', ErrorCodes.VALIDATION_ERROR);
    }

    req.validated = updates;
    next();
  } catch (error) {
    next(error);
  }
}

export function validateWebsiteIdParam(req, res, next) {
  const { id } = req.params;
  if (!OBJECT_ID_REGEX.test(id)) {
    return next(ApiError.badRequest('Invalid website id.', ErrorCodes.INVALID_WEBSITE_ID));
  }
  next();
}
