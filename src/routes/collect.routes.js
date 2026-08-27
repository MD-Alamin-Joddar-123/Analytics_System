import { Router } from 'express';
import { validateCollectEvent } from '../validators/event.validator.js';
import { collectEvent } from '../controllers/event.controller.js';
import { collectRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/', collectRateLimiter, validateCollectEvent, collectEvent);

export default router;
