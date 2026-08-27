import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

function parseRedisUrl(url) {
  try {
    const parsed = new URL(url);
    return { hostname: parsed.hostname || undefined, isSecure: parsed.protocol === 'rediss:' };
  } catch {
    return { hostname: undefined, isSecure: false };
  }
}

let client = null;

export function getRedisConnectionOptions() {
  const redisUrlInfo = parseRedisUrl(env.redisUrl);
  return {
    maxRetriesPerRequest: null,

    enableReadyCheck: false,
    lazyConnect: true,


    family: 4,

    ...(redisUrlInfo.isSecure ? { tls: { servername: redisUrlInfo.hostname } } : {}),

    connectTimeout: 10000,

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
