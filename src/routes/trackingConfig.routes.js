import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { verifyWebsiteOwnership } from '../middleware/verifyWebsiteOwnership.js';
import { detectRateLimiter } from '../middleware/rateLimiter.js';
import { validateTrackingConfigBody } from '../validators/trackingConfig.validator.js';
import { validateDetectBody } from '../validators/trackingConfigDetect.validator.js';
import { saveConfig, detectConfig } from '../controllers/trackingConfig.controller.js';

// The dashboard's own write path — same auth -> ownership -> validate ->
// controller chain reporting.routes.js already established. Mounted
// normally via routes/index.js, so it gets the app-wide restrictive CORS
// policy (config/cors.js's CORS_ORIGINS allowlist), unlike the public GET
// route in trackingConfigPublic.routes.js.
const router = Router({ mergeParams: true });

router.use('/:websiteId', authenticate, verifyWebsiteOwnership);

// PUT is the primary, idempotent "save the complete config" semantic
// (matches websiteTrackingConfig.repository.js's full-replace upsert
// exactly); POST is accepted as an alias for the same handler since the
// dashboard's save action is always "replace," never "append" — there is
// no meaningful difference between the two verbs for a single-document-
// per-website resource.
router.put('/:websiteId', validateTrackingConfigBody, saveConfig);
router.post('/:websiteId', validateTrackingConfigBody, saveConfig);

// Auto Detect Configuration — fetches the supplied product/order page URLs
// server-side and returns a best-guess config for the dashboard to review;
// never saves anything itself (that stays the PUT/POST above, unchanged).
// Rate-limited on top of the usual auth/ownership chain since this is the
// one route in the app that makes a real outbound network request per
// call — see rateLimiter.js's detectRateLimiter for why.
router.post('/:websiteId/detect', detectRateLimiter, validateDetectBody, detectConfig);

export default router;
