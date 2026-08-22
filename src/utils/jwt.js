import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signAuthToken(user) {
  const payload = {
    sub: String(user._id ?? user.id),
    role: user.role,
  };

  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

// Throws jsonwebtoken's TokenExpiredError / JsonWebTokenError on failure —
// callers are responsible for mapping those to API error responses.
export function verifyAuthToken(token) {
  return jwt.verify(token, env.jwtSecret);
}
