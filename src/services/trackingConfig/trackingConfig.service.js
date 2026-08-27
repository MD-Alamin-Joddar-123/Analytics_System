import { websiteRepository } from '../../repositories/website.repository.js';
import { websiteTrackingConfigRepository } from '../../repositories/websiteTrackingConfig.repository.js';
import { toSafeTrackingConfig } from '../../utils/safeTrackingConfig.js';
import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';

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

async function saveConfig(website, updates) {
  const config = await websiteTrackingConfigRepository.upsertByWebsiteId(website.websiteId, updates);
  return toSafeTrackingConfig(config);
}

export const trackingConfigService = { getPublicConfig, saveConfig };
