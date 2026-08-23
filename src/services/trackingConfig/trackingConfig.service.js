import { websiteRepository } from '../../repositories/website.repository.js';
import { websiteTrackingConfigRepository } from '../../repositories/websiteTrackingConfig.repository.js';
import { toSafeTrackingConfig } from '../../utils/safeTrackingConfig.js';
import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';

// GET /api/config/:websiteId is PUBLIC (§2 of this fix) — called by the SDK
// from an arbitrary customer website's browser, exactly like /api/collect
// and GET /tracking.js, never carrying a JWT. It deliberately does NOT
// apply the same active/paused/archived business rule
// event.service.js's resolveActiveWebsite enforces for the collector: this
// config is inert, read-only data (selectors/regex strings, no PII), so
// there's nothing unsafe about a paused website's config still being
// fetchable — only checked here is that a website with this id EXISTS at
// all, so a bogus/typo'd id gets a clean 404 rather than an empty config
// that looks like "configured, but nothing to detect."
async function getPublicConfig(websiteId) {
  const website = await websiteRepository.findByWebsiteId(websiteId);
  if (!website) {
    throw ApiError.notFound('Website not found.', ErrorCodes.WEBSITE_NOT_FOUND);
  }

  const config = await websiteTrackingConfigRepository.findByWebsiteId(websiteId);
  if (!config) {
    throw ApiError.notFound(
      'No tracking configuration has been set up for this website yet.',
      ErrorCodes.TRACKING_CONFIG_NOT_FOUND
    );
  }

  return toSafeTrackingConfig(config);
}

// PUT/POST /api/config/:websiteId is authenticated (§2) — `website` here is
// always the already ownership-verified document verifyWebsiteOwnership
// attached as req.website (same middleware chain reporting.routes.js
// uses), so this function never re-derives or re-checks ownership itself;
// it only knows the public websiteId that middleware already vouched for.
async function saveConfig(website, updates) {
  const config = await websiteTrackingConfigRepository.upsertByWebsiteId(website.websiteId, updates);
  return toSafeTrackingConfig(config);
}

export const trackingConfigService = { getPublicConfig, saveConfig };
