import { websiteRepository } from '../../repositories/website.repository.js';
import { generateWebsiteId } from '../../utils/websiteId.js';
import { toSafeWebsite } from '../../utils/safeWebsite.js';
import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';

const WEBSITE_ID_GENERATION_ATTEMPTS = 5;

// The unique index on `websiteId` is the real collision guarantee; this is
// a pre-check to avoid an unnecessary failed insert in the common case.
// With 8 random bytes (2^64 keyspace), an actual collision here is
// astronomically unlikely, but the retry loop — and the duplicate-key
// fallback below — mean the behavior is correct even if one occurs.
async function generateUniqueWebsiteId() {
  for (let attempt = 0; attempt < WEBSITE_ID_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generateWebsiteId();
    // eslint-disable-next-line no-await-in-loop
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
    // Deliberately the same error for "doesn't exist" and "belongs to
    // someone else" — a 404 here, rather than a 403, avoids confirming to
    // an attacker that a given website id exists but isn't theirs.
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

// Phase 9: the reporting API's ownership check — mirrors getWebsite()
// exactly (same "same 404 whether it doesn't exist or belongs to someone
// else" reasoning), just keyed by the public websiteId reporting routes
// are addressed by, rather than the internal `_id` Phase 3's routes use.
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

  // Archiving is idempotent: archiving an already-archived website just
  // returns its current state rather than erroring, consistent with DELETE
  // being expected to be safe to retry.
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
