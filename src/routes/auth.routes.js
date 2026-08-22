import { Router } from 'express';
import { register, login, me, logout } from '../controllers/auth.controller.js';
import { validateRegistration, validateLogin } from '../validators/auth.validator.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.post('/register', validateRegistration, register);
router.post('/login', validateLogin, login);
router.get('/me', authenticate, me);
router.post('/logout', authenticate, logout);

export default router;
