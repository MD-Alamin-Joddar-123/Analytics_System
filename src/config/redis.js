import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// Single, lazily-constructed, reusable Redis connection (§4: "do not
// create multiple unnecessary Redis connections") shared by the event
// queue producer (src/queues/event.queue.js) and health checks. Never
// constructed at import time — only when something actually needs it —
// so importing this module (e.g. from a test file) never itself triggers
// a connection attempt.
//
// Sharing one connection across BullMQ Queue instances (producer side) is
// safe; a BullMQ Worker needs its own dedicated connection for blocking
// reads, which is why the worker process (src/workers/event.worker.js)
// creates its own separate client rather than importing this one.
let client = null;

export function getRedisConnectionOptions() {
  return {
    // Required by BullMQ: it manages retries at the queue/job level and
    // needs the underlying client to never give up on a single request.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(attempt) {
      return Math.min(attempt * 200, 3000);
    },
  };
}

export function getRedisConnection() {
  if (!client) {
    client = new Redis(env.redisUrl, getRedisConnectionOptions());
    client.on('error', (error) => {
      logger.error('redis_connection_error', { message: error.message });
    });
    client.on('connect', () => logger.info('Redis connected'));
    client.on('close', () => logger.warn('Redis connection closed'));
  }
  return client;
}

const HEALTH_CHECK_TIMEOUT_MS = 2000;

// Never throws — a health check that itself crashes the endpoint would be
// worse than a degraded status. lazyConnect means the first command here
// transparently establishes the connection if it isn't already up.
//
// Bounded by an explicit timeout: `maxRetriesPerRequest: null` (required by
// BullMQ, see getRedisConnectionOptions) combined with a retryStrategy that
// never gives up means a bare `redis.ping()` against a genuinely
// unreachable Redis would otherwise wait for a connection that may never
// arrive — fine for a queue job (it should wait), completely wrong for a
// health check (it must answer promptly). The background reconnect loop
// keeps running either way; this timeout only bounds how long THIS
// function waits before reporting "disconnected".
export async function checkRedisHealth() {
  try {
    const redis = getRedisConnection();
    const pong = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis health check timed out')), HEALTH_CHECK_TIMEOUT_MS)),
    ]);
    return pong === 'PONG' ? 'connected' : 'disconnected';
  } catch {
    return 'disconnected';
  }
}

const DISCONNECT_TIMEOUT_MS = 2000;

// `.quit()` is the graceful path (sends QUIT, waits for in-flight
// commands) but requires an actual open connection to do that over — if
// the client is stuck retrying a connection that never succeeds, `.quit()`
// can itself hang indefinitely rather than reject, which would otherwise
// leave the reconnect loop (and its timers) running forever. Bounded by a
// timeout that falls through to `.disconnect()` — synchronous, forceful,
// unconditionally stops any pending reconnect attempts — so this function
// always actually terminates the client, never just asks nicely and hopes.
export async function disconnectRedis() {
  if (!client) return;
  const toClose = client;
  client = null;

  const quit = toClose.quit().catch(() => {});
  const timedOut = await Promise.race([
    quit.then(() => false),
    new Promise((resolve) => setTimeout(() => resolve(true), DISCONNECT_TIMEOUT_MS)),
  ]);

  if (timedOut) {
    toClose.disconnect();
  }
}
