
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

const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isBlockedIpv4(address) {
  const parts = parseIpv4(address);
  if (!parts) return true;
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

  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
  if (mapped) return isBlockedIpv4(mapped[1]);

  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }
  if (normalized.startsWith('ff')) return true;

  return false;
}

export function isBlockedAddress(address, family) {
  if (typeof address !== 'string' || address.length === 0) return true;
  const resolvedFamily = family ?? (address.includes(':') ? 6 : 4);
  return resolvedFamily === 6 ? isBlockedIpv6(address) : isBlockedIpv4(address);
}
