import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { verifyWebsiteOwnership } from '../middleware/verifyWebsiteOwnership.js';
import { detectRateLimiter } from '../middleware/rateLimiter.js';
import { validateTrackingConfigBody } from '../validators/trackingConfig.validator.js';
import { validateDetectBody } from '../validators/trackingConfigDetect.validator.js';
import { saveConfig, detectConfig } from '../controllers/trackingConfig.controller.js';

const router = Router({ mergeParams: true });

router.use('/:websiteId', authenticate, verifyWebsiteOwnership);

router.put('/:websiteId', validateTrackingConfigBody, saveConfig);
router.post('/:websiteId', validateTrackingConfigBody, saveConfig);

router.post('/:websiteId/detect', detectRateLimiter, validateDetectBody, detectConfig);

export default router;
