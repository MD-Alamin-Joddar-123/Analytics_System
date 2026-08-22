import { websiteService } from '../services/website/website.service.js';
import { isValidWebsiteId } from '../utils/websiteId.js';
import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

// Phase 9 §9: the shared authorization step every reporting route needs —
// JWT (authenticate, runs before this) -> authenticated user ->
// requested website -> ownership verification -> [route handler].
//
// Must run after `authenticate` (reads req.user.id, same as every
// website-management controller already does). Never trusts a
// client-supplied ownerId — ownership is always resolved server-side from
// req.user.id, exactly as Phase 3 established. Reuses websiteService
// rather than querying websiteRepository directly here, so there is
// exactly one place ("does this user own this website") that owns the
// 404-for-both-"missing"-and-"not-yours" decision Phase 3 already made
// (see website.service.js's getWebsite for the original reasoning).
//
// On success, attaches the resolved (safe, ownerId-stripped) website
// document as `req.website` — every reporting controller/service reads
// `req.website.websiteId` rather than re-parsing `req.params.websiteId`,
// and gets `req.website.currency`/`timezone` for free if a report ever
// needs them.
export async function verifyWebsiteOwnership(req, res, next) {
  try {
    const { websiteId } = req.params;

    if (!isValidWebsiteId(websiteId)) {
      throw ApiError.badRequest('Invalid website id.', ErrorCodes.INVALID_WEBSITE_ID);
    }

    req.website = await websiteService.getWebsiteByWebsiteId(websiteId, req.user.id);
    next();
  } catch (error) {
    next(error);
  }
}
