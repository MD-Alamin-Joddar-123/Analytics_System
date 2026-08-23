import { Router } from 'express';
import cors from 'cors';
import { validateTrackingConfigWebsiteIdParam } from '../validators/trackingConfig.validator.js';
import { getPublicConfig } from '../controllers/trackingConfig.controller.js';

// Deliberately its own router, mounted separately in app.js BEFORE the
// app-wide restrictive CORS policy — see that mount point's own comment.
// No `authenticate` here, same reasoning as collect.routes.js: this is
// fetched by the SDK running in an arbitrary customer website's browser,
// which never holds this dashboard's JWT.
const router = Router();
const publicCors = cors({ origin: true, credentials: false });

// A real, previously-shipped bug (found via the dashboard's actual browser
// console, then reproduced with curl -X OPTIONS): registering cors() ONLY
// on the GET route handles the actual GET request but NOT the CORS
// PREFLIGHT the browser sends first. A browser preflights whenever the
// real request carries a non-"simple" header — the dashboard's own
// apiRequest() always attaches Authorization, which is exactly such a
// header (a plain SDK <script>-only fetch with no custom headers would
// never trigger one). Without something explicitly answering OPTIONS here,
// Express auto-responds with a bare `Allow: GET,HEAD` and no CORS headers
// at all, so the browser blocks the preflight before the real GET is ever
// sent. /tracking.js's identical single-verb cors() usage never hit this
// because a <script src> tag never triggers a preflight in the first
// place.
//
// This must be `router.use()`, NOT `router.options('/:websiteId', ...)`:
// Express attaches its own automatic default-OPTIONS responder to the
// shared Route object a path's `.get()`/`.options()` registrations both
// live on — traced directly, a custom `.options()` handler that calls a
// bare `next()` gets re-answered by THAT built-in responder (still no CORS
// headers) rather than continuing to the parent app.js stack, and even
// `next('router')` from inside an `.options()` handler didn't escape it.
// `.use()` middleware isn't part of that Route-object machinery at all, so
// `next('router')` from here reliably reaches the parent stack — verified
// with an isolated routing experiment before trusting it here.
//
// It also can't unconditionally answer EVERY OPTIONS request either: a
// browser preflighting the AUTHENTICATED PUT/POST route sends an
// identical "OPTIONS /api/config/:id" — Express routes OPTIONS purely by
// PATH, so this router sees that preflight too, distinguished only by its
// Access-Control-Request-Method header. Answering it here with the
// permissive policy would leak permissive CORS onto the authenticated
// write route's preflight (caught by testing, not assumed — an early,
// simpler version of this fix did exactly that: an attacker origin came
// back reflected on a PUT preflight). So only a GET/HEAD-shaped preflight
// (or the real GET itself) is answered here; anything else — including a
// non-preflight OPTIONS with no Access-Control-Request-Method at all — is
// passed on to app.js's later, restrictive cors(corsOptions), which is
// what actually protects and answers the PUT/POST route's preflight.
router.use('/:websiteId', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    next('router');
    return;
  }
  if (req.method === 'OPTIONS') {
    const requestedMethod = req.headers['access-control-request-method'];
    if (requestedMethod && requestedMethod.toUpperCase() !== 'GET' && requestedMethod.toUpperCase() !== 'HEAD') {
      next('router');
      return;
    }
  }
  publicCors(req, res, next);
});

router.get('/:websiteId', validateTrackingConfigWebsiteIdParam, getPublicConfig);

export default router;
