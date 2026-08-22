import { ErrorCodes } from '../constants/errorCodes.js';

export class ApiError extends Error {
  constructor(statusCode, message, code = ErrorCodes.INTERNAL_SERVER_ERROR, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, code = ErrorCodes.BAD_REQUEST, details) {
    return new ApiError(400, message, code, details);
  }

  static unauthorized(message = 'Unauthorized', code = ErrorCodes.UNAUTHORIZED) {
    return new ApiError(401, message, code);
  }

  static forbidden(message = 'Forbidden', code = ErrorCodes.FORBIDDEN) {
    return new ApiError(403, message, code);
  }

  static notFound(message = 'Resource not found', code = ErrorCodes.NOT_FOUND) {
    return new ApiError(404, message, code);
  }

  static conflict(message, code = ErrorCodes.CONFLICT) {
    return new ApiError(409, message, code);
  }

  static internal(message = 'Something went wrong', code = ErrorCodes.INTERNAL_SERVER_ERROR) {
    return new ApiError(500, message, code);
  }

  static serviceUnavailable(message = 'Service unavailable', code = ErrorCodes.SERVICE_UNAVAILABLE) {
    return new ApiError(503, message, code);
  }

  static tooManyRequests(message = 'Too many requests', code = ErrorCodes.RATE_LIMITED) {
    return new ApiError(429, message, code);
  }
}
