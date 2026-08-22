import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import {
  validateCreateWebsite,
  validateUpdateWebsite,
  validateWebsiteIdParam,
} from '../validators/website.validator.js';
import {
  createWebsite,
  listWebsites,
  getWebsite,
  updateWebsite,
  deleteWebsite,
} from '../controllers/website.controller.js';

const router = Router();

// Every website management route requires authentication and operates only
// on the authenticated user's own websites — no admin/role check here by
// design (ownership, not role, is the access boundary for Phase 3).
router.use(authenticate);

router.post('/', validateCreateWebsite, createWebsite);
router.get('/', listWebsites);
router.get('/:id', validateWebsiteIdParam, getWebsite);
router.patch('/:id', validateWebsiteIdParam, validateUpdateWebsite, updateWebsite);
router.delete('/:id', validateWebsiteIdParam, deleteWebsite);

export default router;
