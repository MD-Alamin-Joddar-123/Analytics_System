import { trackingConfigService } from '../services/trackingConfig/trackingConfig.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

// GET /api/config/:websiteId — public, called cross-origin by the SDK
// running on an arbitrary customer website (see routes/trackingConfigPublic.routes.js
// for why this is mounted separately from the authenticated route below,
// with its own permissive CORS, exactly like GET /tracking.js).
export async function getPublicConfig(req, res, next) {
  try {
    const config = await trackingConfigService.getPublicConfig(req.params.websiteId);
    // Short, cache-friendly TTL (§2) — same value GET /tracking.js already
    // uses, for the same reason: this is fetched on every page load of
    // every visitor to every configured website, and config changes
    // infrequently (a dashboard admin editing selectors), so a few minutes
    // of staleness is a good trade against hammering this endpoint. Express
    // still adds its own weak ETag automatically (enabled by default,
    // never disabled anywhere in this app), which is what actually lets a
    // conditional GET short-circuit to a 304 within that window.
    res.set('Cache-Control', 'public, max-age=300');
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
