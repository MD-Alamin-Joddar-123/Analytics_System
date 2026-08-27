import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { env } from '../config/env.js';
import { isBlockedAddress } from './privateNetwork.js';


class DetectFetchError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'DetectFetchError';
    this.reason = reason;
  }
}

function parseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DetectFetchError('invalid_url', `"${raw}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DetectFetchError('invalid_url', `"${raw}" must be an http(s) URL.`);
  }
  return parsed;
}

async function resolveValidatedAddress(hostname, lookup, isBlocked) {
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new DetectFetchError('unreachable', `Could not resolve "${hostname}".`);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new DetectFetchError('unreachable', `"${hostname}" did not resolve to any address.`);
  }
  if (addresses.some((a) => isBlocked(a.address, a.family))) {
    throw new DetectFetchError('blocked', `"${hostname}" resolves to a blocked network address.`);
  }
  return addresses[0];
}

function requestOnce({ url, address, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request(
      {
        hostname: address.address,
        family: address.family,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: { Host: url.hostname, 'User-Agent': 'AnalyticsAutoDetect/1.0', Accept: 'text/html' },
        ...(isHttps ? { servername: url.hostname } : {}),
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirectTo: res.headers.location });
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new DetectFetchError('unreachable', `Received HTTP ${status} from "${url.href}".`));
          return;
        }

        const contentType = res.headers['content-type'] || '';
        if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          res.resume();
          reject(new DetectFetchError('unsupported_content_type', `"${url.href}" did not return HTML (got "${contentType}").`));
          return;
        }

        let received = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxBytes) {
            req.destroy();
            reject(new DetectFetchError('too_large', `"${url.href}" response exceeded the ${maxBytes}-byte limit.`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (received <= maxBytes) resolve({ html: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', () => reject(new DetectFetchError('unreachable', `Connection to "${url.href}" failed while reading the response.`)));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new DetectFetchError('timeout', `Fetching "${url.href}" timed out.`));
    });
    req.on('error', () => reject(new DetectFetchError('unreachable', `Could not reach "${url.href}".`)));
    req.end();
  });
}

export async function fetchHtmlSafely(rawUrl, opts = {}) {
  const lookup = opts.lookup ?? dns.promises.lookup;
  const isBlocked = opts.isBlocked ?? isBlockedAddress;
  const timeoutMs = opts.timeoutMs ?? env.detectFetchTimeoutMs;
  const maxRedirects = opts.maxRedirects ?? env.detectMaxRedirects;
  const maxBytes = opts.maxBytes ?? env.detectMaxResponseBytes;

  let currentUrl = parseUrl(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const address = await resolveValidatedAddress(currentUrl.hostname, lookup, isBlocked);
    const result = await requestOnce({ url: currentUrl, address, timeoutMs, maxBytes });

    if ('html' in result) {
      return { html: result.html, finalUrl: currentUrl.href };
    }

    if (hop === maxRedirects) {
      throw new DetectFetchError('too_many_redirects', `"${rawUrl}" redirected more than ${maxRedirects} times.`);
    }
    currentUrl = parseUrl(new URL(result.redirectTo, currentUrl).href);
  }

  throw new DetectFetchError('unreachable', `"${rawUrl}" could not be fetched.`);
}

export { DetectFetchError };

export const ssrfSafeFetch = { fetchHtmlSafely };
