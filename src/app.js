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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// frontend/sdk's Vite build (see frontend/sdk/vite.config.ts) outputs
// directly here — `npm run build` in that package produces this exact
// file, no manual copy step.
const TRACKING_SCRIPT_PATH = path.join(__dirname, '..', 'public', 'tracking.js');

// POST /api/collect is deliberately small: real events are a few hundred
// bytes to a couple KB even with a handful of cart line items. This is
// intentionally tighter than the 1mb default used for the rest of the API.
const COLLECT_BODY_LIMIT = '32kb';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // --- Public event collector -------------------------------------------
  // Mounted BEFORE the app-wide CORS/body-size policy below, and fully
  // self-contained (it ends in a response, never calling next() past
  // itself for a matched POST), so a request to /api/collect never reaches
  // the stricter global middleware registered after it.
  //
  // Why it needs its own CORS policy: the global policy (below) is
  // designed for our own dashboard frontend — a fixed origin allowlist
  // (CORS_ORIGINS) plus credentials:true, because that client sends
  // cookies/auth. The collector's clients are arbitrary customer websites
  // embedding the tracking snippet; we cannot know their origins in
  // advance, and requiring them to be allowlisted would break the whole
  // point of a "universal" collector. Since /api/collect never uses
  // cookies or credentials — it identifies the website via the public
  // websiteId in the request body, never via the browser's ambient
  // credentials — reflecting any origin here is safe: there is no
  // privileged, credentialed action for a hostile page to ride in on.
  // `credentials: false` is explicit so this is never accidentally
  // combined with a wildcard-plus-credentials misconfiguration.
  app.use(
    '/api/collect',
    helmet(),
    cors({ origin: true, credentials: false }),
    express.json({ limit: COLLECT_BODY_LIMIT }),
    requestLogger,
    collectRoutes
  );

  // --- Tracking SDK (Phase 11) --------------------------------------------
  // Serves the built SDK at the exact path the documented installation
  // snippet uses (docs/SDK_INTEGRATION.md): `<script src="https://
  // <this-domain>/tracking.js" data-website-id="...">`. A plain <script
  // src> tag does not require CORS headers to load/execute cross-origin —
  // browsers only enforce CORS for fetch/XHR — but Access-Control-Allow-
  // Origin is set anyway so a customer who adds `crossorigin="anonymous"`
  // to their tag (common for CSP/SRI setups) still works. This is a
  // static-file route, not a second collector — it never touches
  // /api/collect's ingestion path, and this is the only backend change
  // Phase 11 needed to make the documented one-script-tag installation
  // actually servable end-to-end (see docs/SDK_ARCHITECTURE.md).
  app.get('/tracking.js', cors({ origin: true, credentials: false }), (req, res, next) => {
    if (!fs.existsSync(TRACKING_SCRIPT_PATH)) {
      next(ApiError.notFound('Tracking script not found. Run `npm run build` in frontend/sdk first.'));
      return;
    }
    res.type('application/javascript');
    // Short cache: fine for local/dev serving. A production deployment
    // would typically front this with a CDN using a longer/immutable
    // cache policy against a versioned URL — a deployment concern outside
    // this repo, documented in docs/SDK_ARCHITECTURE.md, not implemented
    // here.
    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(TRACKING_SCRIPT_PATH, (err) => {
      if (err) next(err);
    });
  });

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(requestLogger);

  // Swagger UI's bundled page relies on inline scripts/styles, which the
  // default Helmet CSP (already applied above) blocks. A second `helmet()`
  // call can't undo a header the first one already set, so remove it
  // explicitly for this documentation route only.
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
