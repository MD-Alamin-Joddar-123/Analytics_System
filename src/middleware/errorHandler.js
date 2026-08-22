import { env } from '../config/env.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';

function normalizeError(err) {
  if (err instanceof ApiError) {
    return err;
  }

  if (err.name === 'ValidationError') {
    return new ApiError(400, err.message, ErrorCodes.VALIDATION_ERROR);
  }

  if (err.name === 'CastError') {
    return new ApiError(400, `Invalid value for field: ${err.path}`, ErrorCodes.BAD_REQUEST);
  }

  if (err.code === 11000) {
    return new ApiError(409, 'Duplicate resource', ErrorCodes.CONFLICT);
  }

  // body-parser (express.json) errors — surfaced as generic JSON errors
  // rather than the 500 they'd otherwise fall through to.
  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'Payload too large.', ErrorCodes.PAYLOAD_TOO_LARGE);
  }

  if (err.type === 'entity.parse.failed') {
    return new ApiError(400, 'Malformed JSON in request body.', ErrorCodes.VALIDATION_ERROR);
  }

  return new ApiError(500, 'Something went wrong', ErrorCodes.INTERNAL_SERVER_ERROR);
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const apiError = normalizeError(err);

  logger.error('request_error', {
    method: req.method,
    path: req.originalUrl,
    statusCode: apiError.statusCode,
    code: apiError.code,
    message: err.message,
    ...(env.isDevelopment ? { stack: err.stack } : {}),
  });

  const body = {
    success: false,
    message: apiError.message,
    error: {
      code: apiError.code,
    },
  };

  if (env.isDevelopment) {
    body.error.stack = err.stack;
  }

  res.status(apiError.statusCode).json(body);
}
