import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';
import { corsOptions } from './config/cors.js';
import { swaggerSpec } from './config/swagger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { errorHandler } from './middleware/errorHandler.js';
import { ApiError } from './utils/ApiError.js';
import routes from './routes/index.js';
import collectRoutes from './routes/collect.routes.js';
import trackingConfigPublicRoutes from './routes/trackingConfigPublic.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKING_SCRIPT_PATH = path.join(__dirname, '..', 'public', 'tracking.js');

const COLLECT_BODY_LIMIT = '32kb';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(
    '/api/collect',
    helmet(),
    cors({ origin: true, credentials: false }),
    express.json({ limit: COLLECT_BODY_LIMIT, type: ['application/json', 'text/plain'] }),
    requestLogger,
    collectRoutes
  );

  app.get('/tracking.js', cors({ origin: true, credentials: false }), (req, res, next) => {
    if (!fs.existsSync(TRACKING_SCRIPT_PATH)) {
      next(ApiError.notFound('Tracking script not found. Run `npm run build` in frontend/sdk first.'));
      return;
    }
    res.type('application/javascript');
    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(TRACKING_SCRIPT_PATH, (err) => {
      if (err) next(err);
    });
  });

  app.use('/api/config', trackingConfigPublicRoutes);

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(requestLogger);

  app.use(
    '/api-docs',
    (req, res, next) => {
      res.removeHeader('Content-Security-Policy');
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec)
  );
  app.use('/', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
