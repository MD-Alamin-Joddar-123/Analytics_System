
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
