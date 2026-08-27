import { trackingConfigService } from '../services/trackingConfig/trackingConfig.service.js';
import { trackingConfigDetectionService } from '../services/trackingConfig/trackingConfigDetection.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { env } from '../config/env.js';

export async function getPublicConfig(req, res, next) {
  try {
    const config = await trackingConfigService.getPublicConfig(req.params.websiteId);
    res.set('Cache-Control', `public, max-age=${env.trackingConfigCacheSeconds}`);
    sendSuccess(res, { config });
  } catch (error) {
    next(error);
  }
}

export async function saveConfig(req, res, next) {
  try {
    const config = await trackingConfigService.saveConfig(req.website, req.validated);
    sendSuccess(res, { config });
  } catch (error) {
    next(error);
  }
}

export async function detectConfig(req, res, next) {
  try {
    const result = await trackingConfigDetectionService.detectConfig(req.website, req.validated);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}
