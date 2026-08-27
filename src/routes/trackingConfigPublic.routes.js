import { Router } from 'express';
import cors from 'cors';
import { validateTrackingConfigWebsiteIdParam } from '../validators/trackingConfig.validator.js';
import { getPublicConfig } from '../controllers/trackingConfig.controller.js';

const router = Router();
const publicCors = cors({ origin: true, credentials: false });

router.use('/:websiteId', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    next('router');
    return;
  }
  if (req.method === 'OPTIONS') {
    const requestedMethod = req.headers['access-control-request-method'];
    if (requestedMethod && requestedMethod.toUpperCase() !== 'GET' && requestedMethod.toUpperCase() !== 'HEAD') {
      next('router');
      return;
    }
  }
  publicCors(req, res, next);
});

router.get('/:websiteId', validateTrackingConfigWebsiteIdParam, getPublicConfig);

export default router;
