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

    // Hosted-Redis-over-TLS-across-regions stability options (added after
    // a real connect -> close -> reconnect loop against Upstash from
    // Render — the cycle repeated on exactly retryStrategy's 3s cap,
    // meaning the connection kept SUCCEEDING and then being reset almost
    // immediately, not failing to establish at all):

    // Node resolves a hostname to both an A and AAAA record and, by
    // default, may pick the IPv6 address. Some IPv6 paths between a host
    // like Render and a provider's edge/proxy (Upstash included) complete
    // the TCP+TLS handshake but then get reset moments later — invisible
    // to ioredis as anything other than "connected, then closed" on
    // repeat. Forcing IPv4 avoids that route entirely; this is Upstash's
    // own documented recommendation for exactly this symptom.
    family: 4,

    // rediss:// already tells ioredis to use TLS, but an explicit object
    // (even empty) doesn't depend on that URL-parsing inference alone —
    // cheap insurance against a future REDIS_URL pasted without the extra
    // "s", which would otherwise silently attempt a plaintext connection
    // Upstash simply refuses.
    tls: {},

    // A cross-region TLS handshake (Render's region <-> Upstash's Oregon
    // region) is slower than the same-region/localhost case ioredis's
    // default is tuned for. Explicit and generous, so a slightly slow
    // handshake is never itself the thing that tears the connection down.
    connectTimeout: 10000,

    // TCP keepalive (ms) — ioredis disables this by default (0). Without
    // it, a silent, one-sided drop somewhere on the path between Render
    // and Upstash's proxy (a NAT/idle-eviction timeout on hardware
    // neither side controls) is invisible to the socket until the next
    // command is attempted, at which point ioredis has already "lost" the
    // connection and must reconnect. Keepalive probes let the OS detect a
    // dead connection immediately, and — just as importantly — keep an
    // otherwise-idle connection from ever looking dead to anything in
    // between.
    keepAlive: 30000,

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
