import { ApiError } from '../../utils/ApiError.js';
import { ErrorCodes } from '../../constants/errorCodes.js';
import { websiteService } from '../website/website.service.js';
import {
  DetectionSession,
  DETECTION_SESSION_TTL_MS,
} from '../../models/DetectionSession.js';

// All the state-machine rules for one browser-detection session live here
// (§"Backend Changes" steps 2-3): creation by an authenticated owner,
// owner-scoped reads for the dashboard's poller, and token-authenticated
// result submission from the customer site's tracking.js.

function assertNotExpired(session) {
  if (!session.expiresAt || session.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(
      410,
      'Detection session has expired. Start a new detection.',
      ErrorCodes.DETECTION_SESSION_EXPIRED
    );
  }
}

// Results are accepted ONLY for pages whose origin + path match what the
// owner registered — query strings and hash fragments are ignored (thank-
// you pages routinely carry ?orderId=...), trailing slashes normalized.
// This is what stops a hostile page that somehow learned a session id
// from injecting "detection results" for arbitrary URLs.
export function normalizePageUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${path || '/'}`;
}

function registeredSideFor(session, submittedUrl) {
  const submitted = normalizePageUrl(submittedUrl);
  if (!submitted) return null;
  if (session.productUrl && submitted === normalizePageUrl(session.productUrl)) return 'product';
  if (session.orderUrl && submitted === normalizePageUrl(session.orderUrl)) return 'order';
  return null;
}

function toPublicShape(session) {
  return {
    sessionId: session.sessionId,
    websiteId: session.websiteId,
    productUrl: session.productUrl || null,
    orderUrl: session.orderUrl || null,
    status: session.status,
    productResult: session.productResult ?? null,
    orderResult: session.orderResult ?? null,
    failureReason: session.failureReason || null,
    expiresAt: session.expiresAt.toISOString(),
  };
}

async function loadLiveSession(sessionId) {
  const session = await DetectionSession.findOne({ sessionId }).lean();
  if (!session) {
    throw ApiError.notFound(
      'Detection session not found.',
      ErrorCodes.DETECTION_SESSION_NOT_FOUND
    );
  }
  // .lean() returns a plain object — expiresAt stays a Date instance.
  assertNotExpired(session);
  return session;
}

export const detectionSessionService = {
  // `website` is the ownership-verified document resolved by the caller
  // (controller) via websiteService — same single-source-of-truth for
  // "does this user own this website" every other route uses.
  async createSession({ user, website, productUrl, orderUrl }) {
    const session = await DetectionSession.create({
      websiteId: website.websiteId,
      createdByUserId: String(user.id),
      productUrl: productUrl || undefined,
      orderUrl: orderUrl || undefined,
      expiresAt: new Date(Date.now() + DETECTION_SESSION_TTL_MS),
    });
    return toPublicShape(session);
  },

  // Dashboard poller path: authenticate -> session lookup -> expiry ->
  // ownership of the session's website (NOT of the raw id — a user who
  // owns website A must not read sessions created against website B).
  async getSessionForUser(sessionId, userId) {
    const session = await loadLiveSession(sessionId);
    await websiteService.getWebsiteByWebsiteId(session.websiteId, userId);
    return toPublicShape(session);
  },

  // tracking.js submission path. Auth = possession of the unguessable,
  // expiring sessionId — deliberately NO JWT here: the SDK running on the
  // customer's storefront has no dashboard credentials and must never
  // need them (§Security Constraints).
  //
  // stage: 'start' lets the dashboard's poller show granular progress
  // ("the tab we opened is now detecting"), 'complete' delivers findings,
  // 'fail' reports why nothing could be detected on this page.
  async submitResult({ sessionId, url, stage, side, fields, reason }) {
    const session = await loadLiveSession(sessionId);

    const matchedSide = registeredSideFor(session, url);
    if (!matchedSide) {
      throw ApiError.badRequest(
        'Submitted URL does not match any URL registered for this detection session.',
        ErrorCodes.DETECTION_SESSION_URL_MISMATCH
      );
    }
    if (side && side !== matchedSide) {
      throw ApiError.badRequest(
        `Submitted side "${side}" does not match the registered URL this page resolves to ("${matchedSide}").`,
        ErrorCodes.DETECTION_SESSION_URL_MISMATCH
      );
    }
    const effectiveSide = matchedSide;

    const updates = {};
    switch (stage) {
      case 'start':
        updates.status = effectiveSide === 'product' ? 'product_detecting' : 'order_detecting';
        break;
      case 'fail':
        updates.status = 'failed';
        updates.failureReason = (reason || 'Detection failed on page').slice(0, 500);
        break;
      case 'complete': {
        if (effectiveSide === 'product') {
          updates.productResult = fields;
          updates.status =
            !session.orderUrl || session.orderResult ? 'completed' : 'product_completed';
        } else {
          updates.orderResult = fields;
          updates.status =
            session.productResult || !session.productUrl ? 'completed' : 'product_completed';
        }
        break;
      }
      default:
        throw ApiError.badRequest(
          'stage must be one of "start", "complete", "fail".',
          ErrorCodes.DETECTION_SESSION_INVALID_STAGE
        );
    }

    await DetectionSession.updateOne({ _id: session._id }, { $set: updates });
    return toPublicShape({ ...session, ...updates });
  },
};
