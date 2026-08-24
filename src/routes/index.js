import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import websiteRoutes from './website.routes.js';
import reportingRoutes from './reporting.routes.js';
import trackingConfigRoutes from './trackingConfig.routes.js';
import detectionSessionRoutes from './detectionSession.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/websites', websiteRoutes);
router.use('/api/reports', reportingRoutes);
// Authenticated PUT/POST only — the public GET counterpart is mounted
// separately in app.js, before the app-wide CORS policy. See that mount
// point's comment for why the split is necessary.
router.use('/api/config', trackingConfigRoutes);
// Browser-rendered-DOM detection sessions — dashboard-facing half only
// (POST create + GET poll, JWT-authenticated). The tracking.js-facing
// POST /api/detection/result is mounted separately in app.js with its own
// permissive CORS; see detectionSession.routes.js.
router.use('/api/detection', detectionSessionRoutes);

export default router;
