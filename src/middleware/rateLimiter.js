import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// Development-only, single-process, in-memory fixed-window limiter.
//
// NOT production-grade distributed rate limiting: state lives in a Map on
// this one process, is lost on restart, and isn't shared across instances
// behind a load balancer. It exists purely to establish the middleware
// boundary — a real limiter (Redis-backed, shared across instances) can
// replace the body of this function later without touching the route
// wiring, the validator, the service, or anything downstream of it.
//
// This factory is deliberately a pure, always-enforcing implementation
// with no environment-awareness of its own — see `collectRateLimiter`
// below for where the test-suite bypass lives instead. Keeping the bypass
// out of here means the factory itself stays honestly unit-testable.
export function createInMemoryRateLimiter({ windowMs, max, keyGenerator }) {
  const hits = new Map(); // key -> { count, resetAt }

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

// Generous defaults sized for real browser traffic (a page can fire
// several events per navigation) while still bounding abuse from a single
// source. Keyed by IP — coarse-grained on purpose; a future distributed
// limiter can key by websiteId, IP+websiteId, or anything else without
// changing how this middleware is wired into the route.
const baseCollectLimiter = createInMemoryRateLimiter({
  windowMs: 10_000,
  max: 300,
  keyGenerator: (req) => req.ip,
});

// The actual middleware wired into POST /api/collect. The env.isTest
// bypass lives at this call site (not in the factory above) so it only
// affects the real route, never the factory's own unit tests: the
// automated suite fires many requests in rapid succession, and a limiter
// tuned for real traffic would make it flaky.
export function collectRateLimiter(req, res, next) {
  if (env.isTest) {
    next();
    return;
  }
  baseCollectLimiter(req, res, next);
}

// Tracking config Auto Detect makes a real outbound network request per
// call (src/utils/ssrfSafeFetch.js) and is exactly the kind of endpoint
// that would otherwise double as a port-scanning/SSRF-probing oracle for a
// compromised-but-authenticated account — tighter than the collector
// limiter above, and keyed by user id rather than IP since this route is
// always authenticated (a stable per-account key beats per-IP here).
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
