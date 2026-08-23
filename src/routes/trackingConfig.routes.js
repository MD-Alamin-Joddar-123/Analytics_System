import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { verifyWebsiteOwnership } from '../middleware/verifyWebsiteOwnership.js';
import { validateTrackingConfigBody } from '../validators/trackingConfig.validator.js';
import { saveConfig } from '../controllers/trackingConfig.controller.js';

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

export default router;
