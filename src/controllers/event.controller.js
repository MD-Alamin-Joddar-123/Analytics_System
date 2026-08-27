import { eventService } from '../services/event/event.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function collectEvent(req, res, next) {
  try {
    const result = await eventService.collectEvent(req.validated, {
      receivedAt: new Date(),
      userAgent: req.headers['user-agent'],
    });

    sendSuccess(res, result, result.duplicate ? 200 : 202);
  } catch (error) {
    next(error);
  }
}
