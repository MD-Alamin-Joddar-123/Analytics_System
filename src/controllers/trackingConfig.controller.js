import { trackingConfigService } from '../services/trackingConfig/trackingConfig.service.js';
import { trackingConfigDetectionService } from '../services/trackingConfig/trackingConfigDetection.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { env } from '../config/env.js';

// GET /api/config/:websiteId — public, called cross-origin by the SDK
// running on an arbitrary customer website (see routes/trackingConfigPublic.routes.js
// for why this is mounted separately from the authenticated route below,
// with its own permissive CORS, exactly like GET /tracking.js).
export async function getPublicConfig(req, res, next) {
  try {
    const config = await trackingConfigService.getPublicConfig(req.params.websiteId);
    // Short, cache-friendly TTL (§2): this is fetched on every page load of
    // every visitor to every configured website, so it must not be
    // uncacheable. Express still adds its own weak ETag automatically
    // (enabled by default, never disabled anywhere in this app), which is
    // what lets a repeat fetch short-circuit to a 304 — so the cost of a
    // shorter window is a conditional request, not a full response.
    //
    // Deliberately SHORTER than /tracking.js's 300s, which used to match.
    // The script is a build artifact that changes on deploys; this config
    // is edited interactively in the dashboard, and is verified by the
    // admin immediately afterwards by reloading their own storefront. At
    // 300s that check showed the OLD config for five minutes, which reads
    // exactly like the save having failed — and cost real debugging time.
    res.set('Cache-Control', `public, max-age=${env.trackingConfigCacheSeconds}`);
    sendSuccess(res, { config });
  } catch (error) {
    next(error);
  }
}

// PUT/POST /api/config/:websiteId — authenticated, dashboard-only (see
// routes/trackingConfig.routes.js: authenticate -> verifyWebsiteOwnership
// already ran, so req.website is the ownership-verified website, exactly
// like every reporting.routes.js controller).
export async function saveConfig(req, res, next) {
  try {
    const config = await trackingConfigService.saveConfig(req.website, req.validated);
    sendSuccess(res, { config });
  } catch (error) {
    next(error);
  }
}

// POST /api/config/:websiteId/detect — authenticated, same ownership chain
// as saveConfig above. Fetches the supplied product/order URLs server-side
// and returns a best-guess config for the dashboard to review; it never
// saves anything itself — Save Configuration is the existing, unchanged
// PUT/POST flow above, reused as-is.
export async function detectConfig(req, res, next) {
  try {
    const result = await trackingConfigDetectionService.detectConfig(req.website, req.validated);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}
