import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { MIN_PASSWORD_LENGTH } from '../utils/password.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidEmail(value) {
  return isNonEmptyString(value) && EMAIL_REGEX.test(value.trim());
}

export function validateRegistration(req, res, next) {
  const body = req.body || {};
  const { name, email, password } = body;

  if (!isNonEmptyString(name)) {
    return next(ApiError.badRequest('Name is required.', ErrorCodes.VALIDATION_ERROR));
  }

  if (!isValidEmail(email)) {
    return next(ApiError.badRequest('A valid email address is required.', ErrorCodes.VALIDATION_ERROR));
  }

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return next(
      ApiError.badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, ErrorCodes.VALIDATION_ERROR)
    );
  }

  req.validated = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
  };

  next();
}

export function validateLogin(req, res, next) {
  const body = req.body || {};
  const { email, password } = body;

  if (!isValidEmail(email)) {
    return next(ApiError.badRequest('A valid email address is required.', ErrorCodes.VALIDATION_ERROR));
  }

  if (typeof password !== 'string' || password.length === 0) {
    return next(ApiError.badRequest('Password is required.', ErrorCodes.VALIDATION_ERROR));
  }

  req.validated = {
    email: email.trim().toLowerCase(),
    password,
  };

  next();
}
