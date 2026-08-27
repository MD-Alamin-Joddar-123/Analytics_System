import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { SUPPORTED_GRANULARITIES } from '../constants/analyticsGranularity.js';
import { SUPPORTED_EVENTS } from '../constants/eventTypes.js';
import {
  PAGINATION_DEFAULT_PAGE,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  MAX_RANGE_DAYS_BY_GRANULARITY,
  DEFAULT_GRANULARITY,
  OBSERVABILITY_MAX_RANGE_DAYS,
} from '../constants/reportingLimits.js';
import {
  PRODUCT_SORT_FIELDS,
  DEFAULT_PRODUCT_SORT,
  DEFAULT_SORT_ORDER,
  SORT_ORDERS,
  VISITOR_SORT_FIELDS,
  DEFAULT_VISITOR_SORT,
  SESSION_SORT_FIELDS,
  DEFAULT_SESSION_SORT,
  EVENT_SORT_FIELDS,
  DEFAULT_EVENT_SORT,
  ORDER_SORT_FIELDS,
  DEFAULT_ORDER_SORT,
} from '../constants/reportingSort.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRODUCT_ID_MAX_LENGTH = 200;
const ANALYTICS_ID_MAX_LENGTH = 128;
const ORDER_ID_MAX_LENGTH = 200;

function parseIsoDate(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw ApiError.badRequest(
      `"${label}" is required and must be an ISO 8601 date/time string.`,
      ErrorCodes.INVALID_DATE_RANGE
    );
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw ApiError.badRequest(`"${label}" must be a valid ISO 8601 date/time string.`, ErrorCodes.INVALID_DATE_RANGE);
  }
  return new Date(ms);
}

function validateGranularityValue(value) {
  const granularity = value === undefined ? DEFAULT_GRANULARITY : value;
  if (!SUPPORTED_GRANULARITIES.includes(granularity)) {
    throw ApiError.badRequest(
      `"granularity" must be one of: ${SUPPORTED_GRANULARITIES.join(', ')}.`,
      ErrorCodes.INVALID_GRANULARITY
    );
  }
  return granularity;
}

export function validateReportQuery(req, res, next) {
  try {
    const granularity = validateGranularityValue(req.query.granularity);
    const from = parseIsoDate(req.query.from, 'from');
    const to = parseIsoDate(req.query.to, 'to');

    if (from.getTime() > to.getTime()) {
      throw ApiError.badRequest('"from" must be less than or equal to "to".', ErrorCodes.INVALID_DATE_RANGE);
    }

    const maxRangeDays = MAX_RANGE_DAYS_BY_GRANULARITY[granularity];
    const rangeDays = (to.getTime() - from.getTime()) / DAY_MS;
    if (rangeDays > maxRangeDays) {
      throw ApiError.badRequest(
        `The requested date range is too large for granularity "${granularity}" (maximum ${maxRangeDays} days).`,
        ErrorCodes.INVALID_DATE_RANGE
      );
    }

    req.reportQuery = { from, to, granularity };
    next();
  } catch (error) {
    next(error);
  }
}

export function validatePagination(req, res, next) {
  try {
    let page = PAGINATION_DEFAULT_PAGE;
    if (req.query.page !== undefined) {
      page = Number(req.query.page);
      if (!Number.isInteger(page) || page < 1) {
        throw ApiError.badRequest('"page" must be a positive integer.', ErrorCodes.INVALID_PAGINATION);
      }
    }

    let limit = PAGINATION_DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > PAGINATION_MAX_LIMIT) {
        throw ApiError.badRequest(
          `"limit" must be an integer between 1 and ${PAGINATION_MAX_LIMIT}.`,
          ErrorCodes.INVALID_PAGINATION
        );
      }
    }

    req.pagination = { page, limit, skip: (page - 1) * limit };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateProductSort(req, res, next) {
  try {
    const sortKey = req.query.sort === undefined ? DEFAULT_PRODUCT_SORT : req.query.sort;
    if (!Object.prototype.hasOwnProperty.call(PRODUCT_SORT_FIELDS, sortKey)) {
      throw ApiError.badRequest(
        `"sort" must be one of: ${Object.keys(PRODUCT_SORT_FIELDS).join(', ')}.`,
        ErrorCodes.INVALID_SORT
      );
    }

    const orderKey = req.query.order === undefined ? DEFAULT_SORT_ORDER : String(req.query.order).toLowerCase();
    if (!SORT_ORDERS.includes(orderKey)) {
      throw ApiError.badRequest(`"order" must be one of: ${SORT_ORDERS.join(', ')}.`, ErrorCodes.INVALID_SORT);
    }

    req.sort = { key: sortKey, field: PRODUCT_SORT_FIELDS[sortKey], order: orderKey === 'asc' ? 1 : -1 };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateProductIdParam(req, res, next) {
  const { productId } = req.params;
  if (typeof productId !== 'string' || productId.trim().length === 0 || productId.length > PRODUCT_ID_MAX_LENGTH) {
    return next(ApiError.badRequest('Invalid product id.', ErrorCodes.INVALID_PRODUCT_ID));
  }
  next();
}


function createIdParamValidator(paramName, maxLength, errorCode) {
  return function validateIdParam(req, res, next) {
    const value = req.params[paramName];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
      return next(ApiError.badRequest(`Invalid ${paramName}.`, errorCode));
    }
    next();
  };
}

export const validateVisitorIdParam = createIdParamValidator('visitorId', ANALYTICS_ID_MAX_LENGTH, ErrorCodes.INVALID_VISITOR_ID);
export const validateSessionIdParam = createIdParamValidator('sessionId', ANALYTICS_ID_MAX_LENGTH, ErrorCodes.INVALID_SESSION_ID);
export const validateOrderIdParam = createIdParamValidator('orderId', ORDER_ID_MAX_LENGTH, ErrorCodes.INVALID_ORDER_ID);

const EVENT_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;
export function validateEventIdParam(req, res, next) {
  const { eventId } = req.params;
  if (typeof eventId !== 'string' || !EVENT_ID_REGEX.test(eventId)) {
    return next(ApiError.badRequest('Invalid eventId.', ErrorCodes.INVALID_EVENT_ID));
  }
  next();
}

function createSortValidator(fieldMap, defaultKey) {
  return function validateSort(req, res, next) {
    try {
      const sortKey = req.query.sort === undefined ? defaultKey : req.query.sort;
      if (!Object.prototype.hasOwnProperty.call(fieldMap, sortKey)) {
        throw ApiError.badRequest(`"sort" must be one of: ${Object.keys(fieldMap).join(', ')}.`, ErrorCodes.INVALID_SORT);
      }

      const orderKey = req.query.order === undefined ? DEFAULT_SORT_ORDER : String(req.query.order).toLowerCase();
      if (!SORT_ORDERS.includes(orderKey)) {
        throw ApiError.badRequest(`"order" must be one of: ${SORT_ORDERS.join(', ')}.`, ErrorCodes.INVALID_SORT);
      }

      req.sort = { key: sortKey, field: fieldMap[sortKey], order: orderKey === 'asc' ? 1 : -1 };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const validateVisitorSort = createSortValidator(VISITOR_SORT_FIELDS, DEFAULT_VISITOR_SORT);
export const validateSessionSort = createSortValidator(SESSION_SORT_FIELDS, DEFAULT_SESSION_SORT);
export const validateEventSort = createSortValidator(EVENT_SORT_FIELDS, DEFAULT_EVENT_SORT);
export const validateOrderSort = createSortValidator(ORDER_SORT_FIELDS, DEFAULT_ORDER_SORT);

export function validateOptionalDateRange(req, res, next) {
  try {
    const { from: fromRaw, to: toRaw } = req.query;
    let from;
    let to;

    if (fromRaw !== undefined) {
      if (typeof fromRaw !== 'string' || !Number.isFinite(Date.parse(fromRaw))) {
        throw ApiError.badRequest('"from" must be a valid ISO 8601 date/time string.', ErrorCodes.INVALID_DATE_RANGE);
      }
      from = new Date(fromRaw);
    }
    if (toRaw !== undefined) {
      if (typeof toRaw !== 'string' || !Number.isFinite(Date.parse(toRaw))) {
        throw ApiError.badRequest('"to" must be a valid ISO 8601 date/time string.', ErrorCodes.INVALID_DATE_RANGE);
      }
      to = new Date(toRaw);
    }
    if (from !== undefined && to !== undefined) {
      if (from.getTime() > to.getTime()) {
        throw ApiError.badRequest('"from" must be less than or equal to "to".', ErrorCodes.INVALID_DATE_RANGE);
      }
      const rangeDays = (to.getTime() - from.getTime()) / DAY_MS;
      if (rangeDays > OBSERVABILITY_MAX_RANGE_DAYS) {
        throw ApiError.badRequest(
          `The requested date range is too large (maximum ${OBSERVABILITY_MAX_RANGE_DAYS} days).`,
          ErrorCodes.INVALID_DATE_RANGE
        );
      }
    }

    req.activityRange = { from, to };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateEventTypeFilter(req, res, next) {
  const { eventName } = req.query;
  if (eventName === undefined) {
    return next();
  }
  if (typeof eventName !== 'string' || !SUPPORTED_EVENTS.includes(eventName)) {
    return next(
      ApiError.badRequest(`"eventName" must be one of: ${SUPPORTED_EVENTS.join(', ')}.`, ErrorCodes.INVALID_EVENT_TYPE_FILTER)
    );
  }
  req.eventTypeFilter = eventName;
  next();
}

export function validateActivityIdFilters(req, res, next) {
  try {
    const filters = {};
    if (req.query.visitorId !== undefined) {
      if (typeof req.query.visitorId !== 'string' || req.query.visitorId.length > ANALYTICS_ID_MAX_LENGTH) {
        throw ApiError.badRequest('"visitorId" must be a plain string.', ErrorCodes.INVALID_VISITOR_ID);
      }
      filters.anonymousId = req.query.visitorId;
    }
    if (req.query.sessionId !== undefined) {
      if (typeof req.query.sessionId !== 'string' || req.query.sessionId.length > ANALYTICS_ID_MAX_LENGTH) {
        throw ApiError.badRequest('"sessionId" must be a plain string.', ErrorCodes.INVALID_SESSION_ID);
      }
      filters.sessionId = req.query.sessionId;
    }
    req.activityIdFilters = filters;
    next();
  } catch (error) {
    next(error);
  }
}
