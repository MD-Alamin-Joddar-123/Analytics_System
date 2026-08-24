import { websiteService } from '../services/website/website.service.js';
import { detectionSessionService } from '../services/trackingConfig/detectionSession.service.js';

// Mirrors verifyWebsiteOwnership's decision, but for a websiteId that
// arrives in the BODY (POST /api/detection/session) rather than the path —
// same single source of truth (websiteService) for the
// 404-for-both-"missing"-and-"not-yours" rule.
async function resolveOwnedWebsite(req) {
  const { websiteId } = req.body ?? {};
  return websiteService.getWebsiteByWebsiteId(websiteId, req.user.id);
}

export async function createDetectionSession(req, res, next) {
  try {
    const website = await resolveOwnedWebsite(req);
    const session = await detectionSessionService.createSession({
      user: req.user,
      website,
      productUrl: req.body.productUrl,
      orderUrl: req.body.orderUrl,
    });
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}

export async function getDetectionSession(req, res, next) {
  try {
    const session = await detectionSessionService.getSessionForUser(
      req.params.sessionId,
      req.user.id
    );
    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}

// No JWT by design — see detectionSession.service.js submitResult. The
// random expiring sessionId in the body IS the credential.
export async function submitDetectionResult(req, res, next) {
  try {
    const { sessionId, url, stage, side, fields, reason } = req.body ?? {};
    const session = await detectionSessionService.submitResult({
      sessionId,
      url,
      stage,
      side,
      fields,
      reason,
    });
    // The SDK only checks response.ok, but the {success,data} envelope
    // keeps this endpoint consistent with every other API response shape.
    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}
