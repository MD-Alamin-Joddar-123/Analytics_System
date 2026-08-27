import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

export function requireRole(...roles) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required.', ErrorCodes.AUTH_REQUIRED));
    }

    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action.', ErrorCodes.FORBIDDEN));
    }

    next();
  };
}
