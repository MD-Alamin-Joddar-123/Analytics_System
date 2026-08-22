// Domain normalization strategy (documented per Phase 3 spec §8):
//
// Input may arrive as "https://example.com", "http://example.com/",
// "example.com", "EXAMPLE.com/some/path?x=1", etc. We normalize to just the
// lowercase hostname — no scheme, no path, no query string, no trailing dot,
// no port:
//
//   https://example.com        -> example.com
//   http://example.com/        -> example.com
//   example.com                -> example.com
//   EXAMPLE.com/shop?ref=1     -> example.com
//
// "www.example.com" and "example.com" are intentionally treated as DISTINCT
// domains. We do not strip a "www." prefix or otherwise merge subdomains,
// because a subdomain can legitimately be a different property than its
// parent domain (e.g. blog.example.com vs. example.com), and silently
// merging them could misattribute tracking data across what a customer
// considers separate sites. A customer who wants both example.com and
// www.example.com tracked registers both as separate websites.
//
// Ports are dropped: domain identity here is about the hostname a customer
// registers, not the environment (dev port, etc.) it happened to be typed
// with.

const DOMAIN_REGEX = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
const MAX_DOMAIN_LENGTH = 253;

export function normalizeDomain(rawDomain) {
  if (typeof rawDomain !== 'string') return null;

  const trimmed = rawDomain.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  return hostname || null;
}

export function isValidDomain(hostname) {
  return (
    typeof hostname === 'string' &&
    hostname.length > 0 &&
    hostname.length <= MAX_DOMAIN_LENGTH &&
    DOMAIN_REGEX.test(hostname)
  );
}
