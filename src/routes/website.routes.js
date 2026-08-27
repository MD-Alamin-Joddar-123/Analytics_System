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

router.use(authenticate);

router.post('/', validateCreateWebsite, createWebsite);
router.get('/', listWebsites);
router.get('/:id', validateWebsiteIdParam, getWebsite);
router.patch('/:id', validateWebsiteIdParam, validateUpdateWebsite, updateWebsite);
router.delete('/:id', validateWebsiteIdParam, deleteWebsite);

export default router;
