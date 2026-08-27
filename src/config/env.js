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
  sessionTimeoutMinutes: Number(process.env.SESSION_TIMEOUT_MINUTES) || 30,
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY) || 5,
  embedWorker: process.env.EMBED_WORKER === 'true',
  queueAttempts: Number(process.env.QUEUE_ATTEMPTS) || 5,
  queueBackoffDelayMs: Number(process.env.QUEUE_BACKOFF) || 1000,
  detectFetchTimeoutMs: Number(process.env.DETECT_FETCH_TIMEOUT_MS) || 8000,
  detectMaxRedirects: Number(process.env.DETECT_MAX_REDIRECTS) || 3,

  trackingConfigCacheSeconds: Number(process.env.TRACKING_CONFIG_CACHE_SECONDS) || 30,
  detectMaxResponseBytes: Number(process.env.DETECT_MAX_RESPONSE_BYTES) || 2 * 1024 * 1024,
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
  isTest: process.env.NODE_ENV === 'test',
});
