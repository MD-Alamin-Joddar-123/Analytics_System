import { Router } from 'express';
import cors from 'cors';
import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { detectRateLimiter, createInMemoryRateLimiter } from '../middleware/rateLimiter.js';
import {
  validateCreateSessionBody,
  validateDetectionResultBody,
} from '../validators/detectionSession.validator.js';
import {
  createDetectionSession,
  getDetectionSession,
  submitDetectionResult,
} from '../controllers/detectionSession.controller.js';

// --- Dashboard-facing half ------------------------------------------------
// Mounted normally via routes/index.js at /api/detection, so it gets the
// app-wide RESTRICTIVE CORS policy (config/cors.js allowlist) exactly like
// every other authenticated dashboard route.
const router = Router();

// Full paths (spec §"Backend Changes"): POST   /api/detection/session
//                                                  /api/detection/result
//                                          GET    /api/detection/session/:id
router.post(
  '/session',
  authenticate,
  // Same reasoning as the server-side detect route: creation is cheap but
  // abuse-attractive, so reuse the existing limiter.
  detectRateLimiter,
  validateCreateSessionBody,
  createDetectionSession
);

router.get('/session/:sessionId', authenticate, getDetectionSession);

export default router;

// --- tracking.js-facing half ----------------------------------------------
// POST /api/detection/result is called by the CUSTOMER SITE'S OWN
// tracking.js while running on their storefront — arbitrary origins we can
// never allowlist, and no cookies/credentials are involved (the random
// expiring sessionId in the body IS the whole credential). It therefore
// needs the SAME permissive, credential-free CORS treatment as /api/collect
// and must be mounted BEFORE the app-wide restrictive policy (see app.js).
// The permissive cors() is scoped strictly INSIDE this POST-only router so
// a fall-through request can never inherit it — the exact leak class
// trackingConfigPublic.routes.js documents at length.
const RESULT_BODY_LIMIT = '32kb'; // detection payloads are small; mirrors /api/collect

// Per-session throttling: one legitimate detection run needs a handful of
// calls (start + complete per side). Anything hammering this endpoint with
// the same token is either a buggy integration or an attacker probing a
// guessed id — both belong in the mud.
const detectionResultRateLimiter = createInMemoryRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => `${req.body?.sessionId ?? 'unknown'}:${req.ip}`,
});

export const detectionResultRouter = Router();

detectionResultRouter.post(
  '/result',
  cors({ origin: true, credentials: false }),
  express.json({ limit: RESULT_BODY_LIMIT, type: ['application/json', 'text/plain'] }),
  detectionResultRateLimiter,
  validateDetectionResultBody,
  submitDetectionResult
);
