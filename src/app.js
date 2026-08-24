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
import { detectionResultRouter } from './routes/detectionSession.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// frontend/sdk's Vite build (see frontend/sdk/vite.config.js) outputs
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
  // The body parser deliberately accepts `text/plain` IN ADDITION to
  // `application/json`, because the browser transport that actually
  // delivers these events cannot safely use an application/json body.
  //
  // navigator.sendBeacon() — the only transport that reliably survives page
  // unload, and therefore the SDK's primary one — always sends with
  // credentials mode "include". A Blob typed `application/json` is NOT a
  // CORS-safelisted content type, so it forces a PREFLIGHT; a credentialed
  // preflight requires `Access-Control-Allow-Credentials: true`, which this
  // endpoint deliberately does not send (see the credentials:false
  // rationale above). Chrome's exact rejection:
  //
  //   "Response to preflight request doesn't pass access control check:
  //    The value of the 'Access-Control-Allow-Credentials' header in the
  //    response is '' which must be 'true' when the request's credentials
  //    mode is 'include'."
  //
  // The result was a total, SILENT delivery failure: sendBeacon() returns
  // true (meaning "queued"), so the SDK believed every event was sent while
  // the browser discarded all of them before the request left the machine.
  // Server-side testing with curl never reproduced it, because curl does
  // not enforce CORS.
  //
  // `text/plain` IS CORS-safelisted, so the beacon becomes a SIMPLE request:
  // no preflight, and therefore no credentials negotiation to fail. The
  // browser sends it regardless of the response's CORS headers (CORS only
  // blocks *reading* a simple request's response, which a fire-and-forget
  // beacon never does). The body is still JSON — only the declared
  // Content-Type differs — so the validator and every downstream layer are
  // completely unchanged. This is the same approach other privacy-focused
  // analytics SDKs use, and it keeps this endpoint cookie-free rather than
  // "fixing" the preflight by enabling credentials for arbitrary origins.
  app.use(
    '/api/collect',
    helmet(),
    cors({ origin: true, credentials: false }),
    express.json({ limit: COLLECT_BODY_LIMIT, type: ['application/json', 'text/plain'] }),
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

  // --- Public tracking config (dashboard-driven detection) ----------------
  // GET /api/config/:websiteId is fetched by the SDK from the SAME
  // arbitrary customer websites tracking.js itself runs on — it needs the
  // SAME permissive, credential-free CORS treatment as /tracking.js and
  // /api/collect above, mounted here BEFORE the app-wide restrictive
  // corsOptions (config/cors.js's CORS_ORIGINS allowlist), which exists for
  // this dashboard's own frontend, not for arbitrary customer sites.
  //
  // The authenticated PUT/POST counterpart (the dashboard SAVING a config)
  // is a completely separate router — routes/trackingConfig.routes.js,
  // mounted normally via routes/index.js below — so it correctly gets the
  // restrictive corsOptions instead.
  //
  // NOT `app.use('/api/config', cors(...), trackingConfigPublicRoutes)`:
  // that would apply the PERMISSIVE cors() middleware to every request
  // matching the path prefix regardless of HTTP method — including a
  // PUT/POST that falls through this GET-only router — which would leak a
  // permissive Access-Control-Allow-Origin onto the authenticated route's
  // response too (the later restrictive cors(corsOptions), on rejecting an
  // origin, does not clear a header an earlier middleware already set; a
  // real regression caught by tests/trackingConfig.write.test.js). cors()
  // is instead applied inside trackingConfigPublicRoutes itself, scoped to
  // GET/HEAD only (including their OPTIONS preflight — see that file's own
  // comment for why a plain `.get()` + cors() pairing isn't enough once a
  // caller like the dashboard's fetch client sends a non-simple header such
  // as Authorization, which forces a real preflight even on this "public"
  // route). A PUT/POST preflight for the authenticated counterpart below
  // falls through this router untouched and is answered by the restrictive
  // cors(corsOptions) instead.
  app.use('/api/config', trackingConfigPublicRoutes);

  // --- Browser-detection result collector ----------------------------------
  // POST /api/detection/result — the tracking.js-facing half of the
  // browser-rendered-DOM Auto Detect flow. The customer site's OWN
  // tracking.js (opened by the dashboard with
  // ?analytics_detection_session=<id>) reports what it found in the LIVE
  // rendered DOM. Exactly like /api/collect: arbitrary customer origins,
  // zero credentials (the random expiring sessionId in the body is the
  // entire credential), permissive credential-free CORS scoped inside the
  // router itself, and mounted BEFORE the app-wide restrictive corsOptions.
  // See routes/detectionSession.routes.js for the full rationale.
  app.use('/api/detection', detectionResultRouter);

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
