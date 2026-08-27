import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export function createInMemoryRateLimiter({ windowMs, max, keyGenerator }) {
  const hits = new Map();

  return function inMemoryRateLimiter(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      next(ApiError.tooManyRequests('Too many events submitted too quickly. Please slow down.'));
      return;
    }

    next();
  };
}

const baseCollectLimiter = createInMemoryRateLimiter({
  windowMs: 10_000,
  max: 300,
  keyGenerator: (req) => req.ip,
});

export function collectRateLimiter(req, res, next) {
  if (env.isTest) {
    next();
    return;
  }
  baseCollectLimiter(req, res, next);
}

const baseDetectLimiter = createInMemoryRateLimiter({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
});

export function detectRateLimiter(req, res, next) {
  if (env.isTest) {
    next();
    return;
  }
  baseDetectLimiter(req, res, next);
}
