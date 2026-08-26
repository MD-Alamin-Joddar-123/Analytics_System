// Classifies the referrer that STARTED a session into a traffic channel.
//
// Pure and dependency-free so the interesting part — "which bucket does
// this URL belong in" — is unit-testable without a database, the same way
// privateNetwork.js isolates its own rules.
//
// Deliberately session-entry referrers, not per-page-view ones: inside a
// site every page links to every other, so page-view referrers are almost
// entirely self-referential and say nothing about where the visitor came
// FROM. A session's first referrer is the only one that does.

// Host suffixes, matched against the referrer's hostname so
// "www.google.co.uk" and "news.google.com" both count. Kept as suffixes
// rather than exact hosts because every one of these runs dozens of
// country and subdomain variants.
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

// A site's own hostname, with "www." ignored so www and apex are one site.
function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

// Returns { channel, source } — `source` is the human-readable label the
// dashboard groups by ("Direct", "google.com", …), `channel` is the coarse
// bucket it belongs to.
export function classifyReferrer(referrer, siteDomain) {
  const raw = typeof referrer === 'string' ? referrer.trim() : '';
  if (!raw) {
    // No referrer at all: typed the address, a bookmark, a link from an
    // app, or a browser that suppressed it. All genuinely "direct".
    return { channel: TRAFFIC_CHANNELS.DIRECT, source: 'Direct' };
  }

  let hostname;
  try {
    hostname = normalizeHost(new URL(raw).hostname);
  } catch {
    // Not a parseable URL — real data does contain these (mangled
    // referrers, custom app schemes). Reported as-is rather than dropped,
    // so the total still adds up to the number of sessions.
    return { channel: TRAFFIC_CHANNELS.REFERRAL, source: raw.slice(0, 100) };
  }

  if (!hostname) return { channel: TRAFFIC_CHANNELS.DIRECT, source: 'Direct' };

  const site = normalizeHost(siteDomain);
  if (site && (hostname === site || hostname.endsWith(`.${site}`))) {
    // The visitor came from another page of this same site. That is not a
    // traffic SOURCE — it happens whenever the backend starts a fresh
    // session mid-browse after an inactivity gap. Counted under its own
    // channel so it is visible rather than silently inflating "Referral".
    return { channel: TRAFFIC_CHANNELS.INTERNAL, source: 'Internal' };
  }

  if (hostMatches(hostname, SEARCH_HOSTS)) return { channel: TRAFFIC_CHANNELS.SEARCH, source: hostname };
  if (hostMatches(hostname, SOCIAL_HOSTS)) return { channel: TRAFFIC_CHANNELS.SOCIAL, source: hostname };
  if (hostMatches(hostname, EMAIL_HOSTS)) return { channel: TRAFFIC_CHANNELS.EMAIL, source: hostname };

  return { channel: TRAFFIC_CHANNELS.REFERRAL, source: hostname };
}

// Rolls already-grouped entry referrers up into the report shape: one row
// per distinct SOURCE, largest first, each carrying its channel and its
// share of the total.
//
// Takes `[{ referrer, sessions }]` rather than one entry per session
// because Mongo has already done the counting — several distinct referrer
// URLs (every Google country domain, say) still collapse into one source
// row here, which is the grouping the dashboard actually shows.
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
      // Rounded to a tenth of a percent — enough to distinguish small
      // sources without implying precision the sample size can't support.
      share: total > 0 ? Math.round((row.sessions / total) * 1000) / 10 : 0,
    }));
}

// Turns bucketed groups into the shape a multi-line chart wants: one point
// per time bucket, with one numeric key per source.
//
// Only the sources that appear in `keepSources` become keys — the caller
// passes the top few from the totals, because a line per referrer would be
// unreadable the moment a site has more than a handful. Everything else is
// summed into "Other" so the lines still add up to the real session count
// rather than quietly under-reporting.
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

  // Recharts draws a gap where a key is missing, which would read as "no
  // data" rather than "nobody arrived from there in this hour". Zero is
  // the truthful value, so every point carries every key.
  const keys = [...new Set(points.flatMap((point) => Object.keys(point).filter((k) => k !== 'date')))];
  for (const point of points) {
    for (const key of keys) if (point[key] === undefined) point[key] = 0;
  }

  return { points, keys };
}
