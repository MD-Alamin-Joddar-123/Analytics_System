import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import websiteRoutes from './website.routes.js';
import reportingRoutes from './reporting.routes.js';
// TEMPORARY — see debug.routes.js's own header comment. Remove this import
// and the route registration below once the Redis/queue issue is resolved.
import debugRoutes from './debug.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/websites', websiteRoutes);
router.use('/api/reports', reportingRoutes);
router.use('/debug', debugRoutes);

export default router;
