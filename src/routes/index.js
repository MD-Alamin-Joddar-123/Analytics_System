import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import websiteRoutes from './website.routes.js';
import reportingRoutes from './reporting.routes.js';
import trackingConfigRoutes from './trackingConfig.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/websites', websiteRoutes);
router.use('/api/reports', reportingRoutes);
router.use('/api/config', trackingConfigRoutes);

export default router;
