import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { env } from '../config/env.js';
import { isBlockedAddress } from './privateNetwork.js';

// Fetches a page's HTML for the Auto Detect feature — the one place in
// this backend that makes an outbound request to a URL an authenticated
// dashboard user supplies, which is exactly the shape of endpoint SSRF
// (server-side request forgery) targets: a caller who can't reach an
// internal service directly asks THIS server to reach it on their behalf.
//
// The defense here is IP-pinning, not just "check the hostname and hope":
// resolve the hostname ourselves, reject any resolved address that's
// loopback/private/link-local/etc. (src/utils/privateNetwork.js), then
// connect to that EXACT validated IP — never let Node/the OS resolve the
// hostname again at connect time. A "resolve, validate, then fetch by
// hostname" approach still has a DNS-rebinding gap (the name could
// re-resolve to a different, blocked address between the check and the
// actual connection); pinning the IP closes that gap. `Host`/SNI still
// carry the original hostname, so a normal virtual-hosted site still
// resolves to the right content.
//
// Redirects are followed MANUALLY, one hop at a time, re-running every
// check above on each new Location — Node's built-in auto-redirect-follow
// would skip re-validation and reopen the exact hole this exists to close.

class DetectFetchError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'DetectFetchError';
    this.reason = reason; // 'invalid_url' | 'blocked' | 'unreachable' | 'timeout' | 'too_large' | 'too_many_redirects' | 'unsupported_content_type'
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
  // Reject the whole hostname if ANY resolved address is blocked, not just
  // whichever one we'd happen to pick to connect to — a hostname that
  // resolves to both a public and a private address is exactly the shape
  // of a DNS-rebinding setup, not a coincidence worth trusting.
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
        // The critical pin: connect to the RESOLVED, VALIDATED IP, not the
        // hostname (which the OS/Node would otherwise re-resolve itself).
        hostname: address.address,
        family: address.family,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: { Host: url.hostname, 'User-Agent': 'AnalyticsAutoDetect/1.0', Accept: 'text/html' },
        ...(isHttps ? { servername: url.hostname } : {}), // correct SNI/cert check for the real hostname
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume(); // drain, we're not reading this body
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

// `opts.lookup` defaults to the real DNS resolver; tests inject a fake one
// to point a "public-looking" hostname at a local test server. `opts.isBlocked`
// defaults to the real production blocklist (src/utils/privateNetwork.js);
// it exists as a seam purely so tests can prove the "happy path" fetch
// mechanics (redirects, byte cap, IP pinning) against a real local server
// without that server's own loopback address tripping the very check those
// tests aren't targeting — production code never overrides either default.
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
    // Re-validated from the top of the loop on the next iteration — never
    // trusted just because the FIRST hop was public.
    currentUrl = parseUrl(new URL(result.redirectTo, currentUrl).href);
  }

  // Unreachable in practice (the loop above always returns or throws), but
  // keeps this function's return type honest for anything statically
  // analyzing it.
  throw new DetectFetchError('unreachable', `"${rawUrl}" could not be fetched.`);
}

export { DetectFetchError };

// Object form, for callers that want a `t.mock.method`-friendly seam (this
// codebase's established pattern for anything a test needs to replace —
// see every `export const xRepository = {...}`/`export const xService =
// {...}` elsewhere) — trackingConfigDetection.service.js calls through
// this rather than the bare function above, so a route-level test can mock
// the network call without touching real DNS/HTTP at all, while
// ssrfSafeFetch.test.js above keeps testing the real implementation
// directly via the named export.
export const ssrfSafeFetch = { fetchHtmlSafely };
