import { websiteRepository } from '../../repositories/website.repository.js';
import { generateWebsiteId } from '../../utils/websiteId.js';
import { toSafeWebsite } from '../../utils/safeWebsite.js';
import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';

const WEBSITE_ID_GENERATION_ATTEMPTS = 5;

async function generateUniqueWebsiteId() {
  for (let attempt = 0; attempt < WEBSITE_ID_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generateWebsiteId();
    const existing = await websiteRepository.findByWebsiteId(candidate);
    if (!existing) return candidate;
  }
  throw ApiError.internal('Failed to generate a unique website identifier. Please try again.');
}

async function createWebsite({ name, domain, timezone, currency, ownerId }) {
  const websiteId = await generateUniqueWebsiteId();

  try {
    const website = await websiteRepository.create({ name, domain, websiteId, ownerId, timezone, currency });
    return toSafeWebsite(website);
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.websiteId) {
      throw ApiError.conflict('Website ID collision, please retry.', ErrorCodes.DUPLICATE_WEBSITE_ID);
    }
    throw error;
  }
}

async function listWebsites(ownerId) {
  const websites = await websiteRepository.findByOwner(ownerId);
  return websites.map(toSafeWebsite);
}

async function getWebsite(id, ownerId) {
  const website = await websiteRepository.findByIdAndOwner(id, ownerId);
  if (!website) {
    throw ApiError.notFound('Website not found.', ErrorCodes.WEBSITE_NOT_FOUND);
  }
  return toSafeWebsite(website);
}

async function updateWebsite(id, ownerId, updates) {
  const existing = await websiteRepository.findByIdAndOwner(id, ownerId);
  if (!existing) {
    throw ApiError.notFound('Website not found.', ErrorCodes.WEBSITE_NOT_FOUND);
  }

  if (existing.status === 'archived') {
    throw ApiError.conflict(
      'This website has been archived and can no longer be modified.',
      ErrorCodes.WEBSITE_ARCHIVED
    );
  }

  const updated = await websiteRepository.updateByIdAndOwner(id, ownerId, updates);
  return toSafeWebsite(updated);
}

async function getWebsiteByWebsiteId(websiteId, ownerId) {
  const website = await websiteRepository.findByWebsiteIdAndOwner(websiteId, ownerId);
  if (!website) {
    throw ApiError.notFound('Website not found.', ErrorCodes.WEBSITE_NOT_FOUND);
  }
  return toSafeWebsite(website);
}

async function archiveWebsite(id, ownerId) {
  const existing = await websiteRepository.findByIdAndOwner(id, ownerId);
  if (!existing) {
    throw ApiError.notFound('Website not found.', ErrorCodes.WEBSITE_NOT_FOUND);
  }

  if (existing.status === 'archived') {
    return toSafeWebsite(existing);
  }

  const archived = await websiteRepository.archiveByIdAndOwner(id, ownerId);
  return toSafeWebsite(archived);
}

export const websiteService = {
  createWebsite,
  listWebsites,
  getWebsite,
  getWebsiteByWebsiteId,
  updateWebsite,
  archiveWebsite,
};
