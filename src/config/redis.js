import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// Parsed once, defensively: if REDIS_URL is ever malformed, this whole
// module falls back to sane defaults (no forced TLS, inferred servername)
// rather than throwing at import time.
function parseRedisUrl(url) {
  try {
    const parsed = new URL(url);
    return { hostname: parsed.hostname || undefined, isSecure: parsed.protocol === 'rediss:' };
  } catch {
    return { hostname: undefined, isSecure: false };
  }
}

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
  const redisUrlInfo = parseRedisUrl(env.redisUrl);
  return {
    // Required by BullMQ: it manages retries at the queue/job level and
    // needs the underlying client to never give up on a single request.
    maxRetriesPerRequest: null,

    // false, NOT true — this is the actual fix for the observed symptom
    // (repeating "connect" -> "close" within milliseconds, no error
    // event, cycling on retryStrategy's cadence forever). A `true` ready
    // check makes ioredis send an INFO command immediately after connect
    // and tears the connection down if that exchange doesn't behave the
    // way it expects — which is exactly what happens against Upstash's
    // free-tier proxy. The TLS handshake itself was never the problem
    // (the "connect" log line firing proves it succeeds every time); the
    // failure is entirely in this post-connect handshake. This is also
    // BullMQ's own documented recommendation for a connection it doesn't
    // own the lifecycle of.
    enableReadyCheck: false,
    lazyConnect: true,

    // Hosted-Redis-over-TLS-across-regions stability options:

    // Node resolves a hostname to both an A and AAAA record and, by
    // default, may pick the IPv6 address. Kept as defensive insurance
    // against IPv6 route flakiness even though it wasn't the actual cause
    // here (TLS connects fine either way) — forcing IPv4 is still
    // Upstash's own general recommendation for platforms like Render.
    family: 4,

    // Conditional on the URL's actual scheme — NOT unconditionally forced
    // on. A hosted provider reached over the public internet (Upstash,
    // Redis Cloud, ...) uses `rediss://` and needs TLS; a same-network
    // internal Redis (e.g. Render's own Key Value service, or a local
    // `redis://127.0.0.1`) uses plain `redis://` and does NOT speak
    // TLS at all — passing a truthy `tls` option to ioredis forces a TLS
    // handshake regardless of scheme, which would make a plaintext
    // connection fail outright. Deriving this from the real REDIS_URL
    // means the exact same code works for both without a code change when
    // REDIS_URL itself changes. When TLS is on, servername is set
    // explicitly (from the real host, not hardcoded) rather than left to
    // inference, so SNI is never ambiguous against a multi-tenant,
    // proxy-fronted provider like Upstash, where the proxy uses SNI to
    // route the TLS connection to the right backend.
    ...(redisUrlInfo.isSecure ? { tls: { servername: redisUrlInfo.hostname } } : {}),

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
      logger.error('redis_connection_error', { message: error.message, code: error.code, name: error.name });
    });
    // Temporary, deliberately verbose diagnostic logging (Render deploy
    // showed a repeating connect -> close cycle with NO error event at
    // all, which an identical client/URL/options combination does not
    // reproduce from outside Render — see the investigation in this
    // file's git history/PR discussion). `close`'s `hadError` argument and
    // the actual remote address the socket connected to (confirms whether
    // `family: 4` is actually being honored on Render's network) are the
    // two things that couldn't be observed without this. Safe to trim
    // back to the plain connect/close lines once the cause is confirmed.
    client.on('connect', () => {
      const remote = client.stream ? `${client.stream.remoteAddress}:${client.stream.remotePort}` : 'unknown';
      logger.info('Redis connected', { remote });
    });
    client.on('ready', () => logger.info('Redis ready'));
    client.on('close', (hadError) => logger.warn('Redis connection closed', { hadError }));
    client.on('reconnecting', (delay) => logger.warn('Redis reconnecting', { delay }));
    client.on('end', () => logger.warn('Redis connection ended (no more reconnects)'));
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
