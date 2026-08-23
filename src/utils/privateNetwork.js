// Pure IP-range blocklist for the auto-detect feature's SSRF protection
// (backend/src/utils/ssrfSafeFetch.js). No I/O here on purpose — this is
// the security-critical part of that feature (deciding whether an address
// is safe to connect to), so it is kept as a small, independently
// unit-testable module rather than buried inside the fetch logic itself.
//
// Blocks: loopback, RFC1918 private ranges, link-local (which also covers
// the 169.254.169.254 cloud-metadata address every major cloud provider
// uses — that address is NOT special-cased, it falls out of the ordinary
// 169.254.0.0/16 link-local block), CGNAT, "this network"/reserved/
// multicast ranges, and the IPv6 equivalents (loopback, unique-local,
// link-local). An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is unwrapped
// and re-checked against the IPv4 rules — otherwise it would be a trivial
// bypass for every rule above.

function ipv4ToInt(parts) {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseIpv4(address) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts;
}

// [network, prefixLength] pairs, in CIDR form, for every IPv4 range this
// feature must never let the backend connect to.
const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT (RFC6598)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — includes the cloud metadata IP
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1 (documentation)
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2 (documentation)
  ['203.0.113.0', 24], // TEST-NET-3 (documentation)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

function isBlockedIpv4(address) {
  const parts = parseIpv4(address);
  if (!parts) return true; // unparseable — refuse rather than risk it
  const value = ipv4ToInt(parts);
  return IPV4_BLOCKED_RANGES.some(([network, prefixLength]) => {
    const networkParts = parseIpv4(network);
    const networkValue = ipv4ToInt(networkParts);
    const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
    return (value & mask) === (networkValue & mask);
  });
}

function isBlockedIpv6(address) {
  const normalized = address.toLowerCase();

  // IPv4-mapped (::ffff:a.b.c.d) — unwrap and apply the IPv4 rules, or
  // this would be a trivial way to reach a "blocked" IPv4 address under an
  // IPv6 hostname.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
  if (mapped) return isBlockedIpv4(mapped[1]);

  if (normalized === '::1' || normalized === '::') return true; // loopback / unspecified
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique-local
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (normalized.startsWith('ff')) return true; // ff00::/8 multicast

  return false;
}

// `family` is Node's dns.lookup family result (4 or 6) when known; if
// omitted, the address's own shape decides which check to run.
export function isBlockedAddress(address, family) {
  if (typeof address !== 'string' || address.length === 0) return true;
  const resolvedFamily = family ?? (address.includes(':') ? 6 : 4);
  return resolvedFamily === 6 ? isBlockedIpv6(address) : isBlockedIpv4(address);
}
