import { userRepository } from '../../repositories/user.repository.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { signAuthToken } from '../../utils/jwt.js';
import { toSafeUser } from '../../utils/safeUser.js';
import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';

async function registerUser({ name, email, password }) {
  const existingUser = await userRepository.findByEmail(email);
  if (existingUser) {
    throw ApiError.conflict('An account with this email already exists.', ErrorCodes.EMAIL_ALREADY_EXISTS);
  }

  const passwordHash = await hashPassword(password);
  const user = await userRepository.create({ name, email, passwordHash, role: 'user' });
  const token = signAuthToken(user);

  return { user: toSafeUser(user), token };
}

async function loginUser({ email, password }) {
  const user = await userRepository.findByEmail(email, { withPasswordHash: true });
  if (!user) {
    throw ApiError.unauthorized(GENERIC_LOGIN_ERROR, ErrorCodes.INVALID_CREDENTIALS);
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    throw ApiError.unauthorized(GENERIC_LOGIN_ERROR, ErrorCodes.INVALID_CREDENTIALS);
  }

  if (user.status === 'suspended') {
    throw ApiError.forbidden('This account has been suspended.', ErrorCodes.ACCOUNT_SUSPENDED);
  }

  const updatedUser = (await userRepository.updateLastLogin(user._id ?? user.id)) ?? user;
  const token = signAuthToken(user);

  return { user: toSafeUser(updatedUser), token };
}

async function getCurrentUser(userId) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw ApiError.notFound('User not found.', ErrorCodes.USER_NOT_FOUND);
  }
  return toSafeUser(user);
}

function logout() {
  return {
    message: 'Logged out. Discard the access token on the client — it remains cryptographically valid until it expires.',
  };
}

export const authService = {
  registerUser,
  loginUser,
  getCurrentUser,
  logout,
};
