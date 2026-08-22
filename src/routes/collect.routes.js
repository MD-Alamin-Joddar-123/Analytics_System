import { Router } from 'express';
import { validateCollectEvent } from '../validators/event.validator.js';
import { collectEvent } from '../controllers/event.controller.js';
import { collectRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Deliberately no `authenticate` here: websiteId is a public identifier
// (see docs/DATABASE_ARCHITECTURE.md), not a credential. Requiring the
// dashboard's JWT here would make it impossible for a tracking snippet
// embedded in a customer's website to ever call this endpoint.
router.post('/', collectRateLimiter, validateCollectEvent, collectEvent);

export default router;
