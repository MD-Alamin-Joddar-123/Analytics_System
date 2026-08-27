import { websiteService } from '../services/website/website.service.js';
import { isValidWebsiteId } from '../utils/websiteId.js';
import { ApiError } from '../utils/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

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
