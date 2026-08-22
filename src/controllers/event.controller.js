import { eventService } from '../services/event/event.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function collectEvent(req, res, next) {
  try {
    const result = await eventService.collectEvent(req.validated, {
      receivedAt: new Date(),
      userAgent: req.headers['user-agent'],
    });

    // A brand-new event is 202 Accepted (queued/processed asynchronously
    // in spirit, even though Phase 4 persists synchronously). A duplicate
    // is 200 OK — it was already fully processed by an earlier request,
    // there's nothing left to "accept".
    sendSuccess(res, result, result.duplicate ? 200 : 202);
  } catch (error) {
    next(error);
  }
}
