import { verifyAuthToken } from '../utils/jwt.js';
import { userRepository } from '../repositories/user.repository.js';
import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  return token;
}

export async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      throw ApiError.unauthorized('Authentication required.', ErrorCodes.AUTH_REQUIRED);
    }

    let decoded;
    try {
      decoded = verifyAuthToken(token);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('Session expired. Please log in again.', ErrorCodes.TOKEN_EXPIRED);
      }
      throw ApiError.unauthorized('Invalid authentication token.', ErrorCodes.INVALID_TOKEN);
    }

    const user = await userRepository.findById(decoded.sub);
    if (!user) {
      throw ApiError.unauthorized('Invalid authentication token.', ErrorCodes.INVALID_TOKEN);
    }

    if (user.status === 'suspended') {
      throw ApiError.forbidden('This account has been suspended.', ErrorCodes.ACCOUNT_SUSPENDED);
    }

    req.user = {
      id: String(user._id ?? user.id),
      email: user.email,
      role: user.role,
      status: user.status,
    };

    next();
  } catch (error) {
    next(error);
  }
}
