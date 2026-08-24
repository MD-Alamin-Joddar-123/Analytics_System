import dotenv from 'dotenv';

dotenv.config();

const requiredVars = ['MONGODB_URI'];

const missing = requiredVars.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongodbUri: process.env.MONGODB_URI,
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Inactivity window before a session is considered expired and a new one
  // is started on the next event (Phase 5). Configurable rather than
  // hard-coded so it can be tuned per deployment without a code change.
  sessionTimeoutMinutes: Number(process.env.SESSION_TIMEOUT_MINUTES) || 30,
  // Phase 7: queue/worker configuration. Redis connection details, retry
  // policy, and worker concurrency are all environment-driven rather than
  // hard-coded, per §3/§9/§17.
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY) || 5,
  // When true, the API process ALSO runs the event worker in-process
  // instead of requiring a separate worker process (see src/server.js).
  // Opt-in and default-false on purpose: the separate-process deployment
  // (`npm run start:worker`) remains the default and the better choice
  // whenever the hosting plan allows it. Explicitly parsed as the string
  // 'true' rather than Boolean(...) — otherwise any non-empty value,
  // including the literal string "false", would enable it.
  embedWorker: process.env.EMBED_WORKER === 'true',
  queueAttempts: Number(process.env.QUEUE_ATTEMPTS) || 5,
  // Base delay (ms) for exponential backoff between retries: attempt N
  // waits roughly QUEUE_BACKOFF * 2^(N-1) — see src/config/queue.js.
  queueBackoffDelayMs: Number(process.env.QUEUE_BACKOFF) || 1000,
  // Tracking config Auto Detect: fetches a customer-supplied product/order
  // URL server-side (src/utils/ssrfSafeFetch.js) to guess selectors. These
  // bound that fetch — it only ever needs a page's markup, not a full
  // asset-laden load, and must never hang a request indefinitely.
  detectFetchTimeoutMs: Number(process.env.DETECT_FETCH_TIMEOUT_MS) || 8000,
  detectMaxRedirects: Number(process.env.DETECT_MAX_REDIRECTS) || 3,

  // How long a storefront may cache GET /api/config/:websiteId. Short by
  // default because an admin edits this config and then immediately checks
  // their own site to confirm it took effect — see the controller for the
  // full rationale. Raise it if config-fetch volume ever becomes a concern.
  trackingConfigCacheSeconds: Number(process.env.TRACKING_CONFIG_CACHE_SECONDS) || 30,
  detectMaxResponseBytes: Number(process.env.DETECT_MAX_RESPONSE_BYTES) || 2 * 1024 * 1024,
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
  isTest: process.env.NODE_ENV === 'test',
});
