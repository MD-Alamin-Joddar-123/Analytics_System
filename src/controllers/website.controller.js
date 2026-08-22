import { websiteService } from '../services/website/website.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function createWebsite(req, res, next) {
  try {
    const website = await websiteService.createWebsite({ ...req.validated, ownerId: req.user.id });
    sendSuccess(res, { website }, 201);
  } catch (error) {
    next(error);
  }
}

export async function listWebsites(req, res, next) {
  try {
    const websites = await websiteService.listWebsites(req.user.id);
    sendSuccess(res, { websites }, 200);
  } catch (error) {
    next(error);
  }
}

export async function getWebsite(req, res, next) {
  try {
    const website = await websiteService.getWebsite(req.params.id, req.user.id);
    sendSuccess(res, { website }, 200);
  } catch (error) {
    next(error);
  }
}

export async function updateWebsite(req, res, next) {
  try {
    const website = await websiteService.updateWebsite(req.params.id, req.user.id, req.validated);
    sendSuccess(res, { website }, 200);
  } catch (error) {
    next(error);
  }
}

export async function deleteWebsite(req, res, next) {
  try {
    const website = await websiteService.archiveWebsite(req.params.id, req.user.id);
    sendSuccess(res, { website }, 200);
  } catch (error) {
    next(error);
  }
}
