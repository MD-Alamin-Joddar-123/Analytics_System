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
  queueAttempts: Number(process.env.QUEUE_ATTEMPTS) || 5,
  // Base delay (ms) for exponential backoff between retries: attempt N
  // waits roughly QUEUE_BACKOFF * 2^(N-1) — see src/config/queue.js.
  queueBackoffDelayMs: Number(process.env.QUEUE_BACKOFF) || 1000,
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
  isTest: process.env.NODE_ENV === 'test',
});
