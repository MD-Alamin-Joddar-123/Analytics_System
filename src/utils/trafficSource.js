
const SEARCH_HOSTS = [
  'google.', 'bing.', 'yahoo.', 'duckduckgo.', 'yandex.', 'baidu.',
  'ecosia.', 'brave.com', 'startpage.com', 'ask.com', 'aol.',
];

const SOCIAL_HOSTS = [
  'facebook.', 'fb.com', 'm.facebook.', 'l.facebook.', 'instagram.', 'twitter.', 'x.com', 't.co',
  'linkedin.', 'lnkd.in', 'youtube.', 'youtu.be', 'tiktok.', 'pinterest.', 'reddit.',
  'whatsapp.', 'wa.me', 'telegram.', 't.me', 'messenger.', 'snapchat.', 'quora.', 'tumblr.',
];

const EMAIL_HOSTS = ['mail.google.', 'outlook.', 'mail.yahoo.', 'mail.', 'webmail.'];

export const TRAFFIC_CHANNELS = Object.freeze({
  DIRECT: 'direct',
  SEARCH: 'search',
  SOCIAL: 'social',
  EMAIL: 'email',
  REFERRAL: 'referral',
  INTERNAL: 'internal',
});

function hostMatches(hostname, suffixes) {
  return suffixes.some((suffix) => hostname === suffix.replace(/\.$/, '') || hostname.includes(suffix));
}

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

export function classifyReferrer(referrer, siteDomain) {
  const raw = typeof referrer === 'string' ? referrer.trim() : '';
  if (!raw) {
    return { channel: TRAFFIC_CHANNELS.DIRECT, source: 'Direct' };
  }

  let hostname;
  try {
    hostname = normalizeHost(new URL(raw).hostname);
  } catch {
    return { channel: TRAFFIC_CHANNELS.REFERRAL, source: raw.slice(0, 100) };
  }

  if (!hostname) return { channel: TRAFFIC_CHANNELS.DIRECT, source: 'Direct' };

  const site = normalizeHost(siteDomain);
  if (site && (hostname === site || hostname.endsWith(`.${site}`))) {
    return { channel: TRAFFIC_CHANNELS.INTERNAL, source: 'Internal' };
  }

  if (hostMatches(hostname, SEARCH_HOSTS)) return { channel: TRAFFIC_CHANNELS.SEARCH, source: hostname };
  if (hostMatches(hostname, SOCIAL_HOSTS)) return { channel: TRAFFIC_CHANNELS.SOCIAL, source: hostname };
  if (hostMatches(hostname, EMAIL_HOSTS)) return { channel: TRAFFIC_CHANNELS.EMAIL, source: hostname };

  return { channel: TRAFFIC_CHANNELS.REFERRAL, source: hostname };
}

export function summarizeTrafficSources(groups, siteDomain) {
  const bySource = new Map();
  let total = 0;

  for (const group of groups) {
    const count = Number(group?.sessions) || 0;
    if (count <= 0) continue;
    total += count;

    const { channel, source } = classifyReferrer(group.referrer, siteDomain);
    const existing = bySource.get(source);
    if (existing) existing.sessions += count;
    else bySource.set(source, { source, channel, sessions: count });
  }

  return [...bySource.values()]
    .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source))
    .map((row) => ({
      ...row,
      share: total > 0 ? Math.round((row.sessions / total) * 1000) / 10 : 0,
    }));
}

export function buildTrafficSourceSeries(bucketGroups, siteDomain, keepSources) {
  const keep = new Set(keepSources);
  const byBucket = new Map();

  for (const group of bucketGroups) {
    const count = Number(group?.sessions) || 0;
    if (count <= 0) continue;

    const iso = group.bucket instanceof Date ? group.bucket.toISOString() : String(group.bucket);
    const { source } = classifyReferrer(group.referrer, siteDomain);
    const key = keep.has(source) ? source : 'Other';

    if (!byBucket.has(iso)) byBucket.set(iso, { date: iso });
    const point = byBucket.get(iso);
    point[key] = (point[key] ?? 0) + count;
  }

  const points = [...byBucket.values()].sort((a, b) => a.date.localeCompare(b.date));

  const keys = [...new Set(points.flatMap((point) => Object.keys(point).filter((k) => k !== 'date')))];
  for (const point of points) {
    for (const key of keys) if (point[key] === undefined) point[key] = 0;
  }

  return { points, keys };
}
