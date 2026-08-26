import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyReferrer,
  summarizeTrafficSources,
  buildTrafficSourceSeries,
  TRAFFIC_CHANNELS,
} from '../src/utils/trafficSource.js';

const SITE = 'academy.adspillar.com';

describe('classifyReferrer', () => {
  test('no referrer at all is Direct', () => {
    for (const empty of [null, undefined, '', '   ']) {
      const { channel, source } = classifyReferrer(empty, SITE);
      assert.equal(channel, TRAFFIC_CHANNELS.DIRECT);
      assert.equal(source, 'Direct');
    }
  });

  test("the site's OWN pages are Internal, not a traffic source", () => {
    // This is the common case, and the reason it needs its own channel: the
    // backend starts a fresh session after an inactivity gap, so a visitor
    // already browsing the site produces a session whose entry referrer is
    // one of its own pages. Counting those as "Referral" would make the
    // site look like its own biggest acquisition channel.
    for (const own of [
      'https://academy.adspillar.com/shop/',
      'https://www.academy.adspillar.com/cart/',
      'https://academy.adspillar.com/checkout/order-received/48599/?key=wc_abc',
    ]) {
      assert.equal(classifyReferrer(own, SITE).channel, TRAFFIC_CHANNELS.INTERNAL, own);
    }
  });

  test('a subdomain of the site is still Internal', () => {
    assert.equal(classifyReferrer('https://blog.academy.adspillar.com/post', SITE).channel, TRAFFIC_CHANNELS.INTERNAL);
  });

  test('a site whose name merely ENDS with the domain is not Internal', () => {
    // "notacademy.adspillar.com" must not match "academy.adspillar.com".
    const { channel } = classifyReferrer('https://notacademy.adspillar.com/x', SITE);
    assert.notEqual(channel, TRAFFIC_CHANNELS.INTERNAL);
  });

  test('search engines are Search, across country and subdomain variants', () => {
    for (const url of [
      'https://www.google.com/search?q=fish',
      'https://google.co.uk/',
      'https://news.google.com/',
      'https://duckduckgo.com/?q=x',
      'https://www.bing.com/search?q=x',
      'https://yandex.ru/',
    ]) {
      assert.equal(classifyReferrer(url, SITE).channel, TRAFFIC_CHANNELS.SEARCH, url);
    }
  });

  test('social networks are Social, including short-link domains', () => {
    for (const url of [
      'https://www.facebook.com/',
      'https://m.facebook.com/story',
      'https://l.facebook.com/l.php?u=x',
      'https://t.co/abc',
      'https://x.com/someone/status/1',
      'https://www.instagram.com/',
      'https://youtu.be/abc',
      'https://www.linkedin.com/feed/',
    ]) {
      assert.equal(classifyReferrer(url, SITE).channel, TRAFFIC_CHANNELS.SOCIAL, url);
    }
  });

  test('anything else is Referral, reported by its hostname', () => {
    const { channel, source } = classifyReferrer('https://www.someblog.example/post/1', SITE);
    assert.equal(channel, TRAFFIC_CHANNELS.REFERRAL);
    assert.equal(source, 'someblog.example', 'www. is stripped so one site is one row');
  });

  test('an unparseable referrer is kept as Referral rather than dropped', () => {
    // Real data contains these. Dropping them would make the per-source
    // counts stop adding up to the session total.
    const { channel, source } = classifyReferrer('android-app://com.example.thing', SITE);
    assert.equal(channel, TRAFFIC_CHANNELS.REFERRAL);
    assert.ok(source.length > 0);
  });

  test('a referrer longer than any sane URL is truncated, not passed through whole', () => {
    const { source } = classifyReferrer(`not a url ${'x'.repeat(500)}`, SITE);
    assert.ok(source.length <= 100);
  });
});

describe('summarizeTrafficSources', () => {
  const GROUPS = [
    { referrer: null, sessions: 34 },
    { referrer: 'https://academy.adspillar.com/shop/', sessions: 15 },
    { referrer: 'https://academy.adspillar.com/cart/', sessions: 5 },
    { referrer: 'https://www.google.com/search?q=a', sessions: 8 },
    { referrer: 'https://google.co.uk/', sessions: 2 },
    { referrer: 'https://www.facebook.com/', sessions: 6 },
  ];

  const rows = summarizeTrafficSources(GROUPS, SITE);
  const bySource = Object.fromEntries(rows.map((r) => [r.source, r]));

  test('several referrer URLs from the same site collapse into ONE source row', () => {
    // Two Google domains, two internal pages — four inputs, two rows.
    assert.equal(bySource['Internal'].sessions, 20);
    assert.equal(rows.filter((r) => r.channel === TRAFFIC_CHANNELS.SEARCH).length, 2, 'google.com and google.co.uk stay distinct hostnames');
  });

  test('rows are ordered by session count, largest first', () => {
    const counts = rows.map((r) => r.sessions);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  });

  test('shares add up to about 100%, and every session is accounted for', () => {
    const totalSessions = rows.reduce((sum, r) => sum + r.sessions, 0);
    assert.equal(totalSessions, 70, 'no session may be silently dropped');
    const totalShare = rows.reduce((sum, r) => sum + r.share, 0);
    assert.ok(Math.abs(totalShare - 100) < 0.5, `shares summed to ${totalShare}`);
  });

  test('an empty range produces an empty report, not a divide-by-zero', () => {
    assert.deepEqual(summarizeTrafficSources([], SITE), []);
  });

  test('groups with no sessions are ignored rather than creating 0-count rows', () => {
    const withZero = summarizeTrafficSources([{ referrer: 'https://x.example/', sessions: 0 }], SITE);
    assert.deepEqual(withZero, []);
  });
});

describe('buildTrafficSourceSeries', () => {
  const BUCKETS = [
    { bucket: new Date('2026-08-24T00:00:00Z'), referrer: null, sessions: 19 },
    { bucket: new Date('2026-08-24T00:00:00Z'), referrer: 'https://academy.adspillar.com/shop/', sessions: 15 },
    { bucket: new Date('2026-08-24T00:00:00Z'), referrer: 'https://www.google.com/', sessions: 5 },
    { bucket: new Date('2026-08-25T00:00:00Z'), referrer: null, sessions: 12 },
    { bucket: new Date('2026-08-25T00:00:00Z'), referrer: 'https://tiny.example/', sessions: 2 },
  ];

  test('produces one point per bucket, in chronological order', () => {
    const { points } = buildTrafficSourceSeries(BUCKETS, SITE, ['Direct', 'Internal', 'google.com']);
    assert.equal(points.length, 2);
    assert.ok(points[0].date < points[1].date);
  });

  test('each point carries a numeric key per source', () => {
    const { points } = buildTrafficSourceSeries(BUCKETS, SITE, ['Direct', 'Internal', 'google.com']);
    assert.equal(points[0].Direct, 19);
    assert.equal(points[0].Internal, 15);
    assert.equal(points[0]['google.com'], 5);
  });

  test('sources outside the keep-list are summed into "Other", never dropped', () => {
    const keep = ['Direct', 'Internal'];
    const { points, keys } = buildTrafficSourceSeries(BUCKETS, SITE, keep);
    assert.ok(keys.includes('Other'), 'an Other series must exist');
    // Bucket 1: google (5) -> Other. Bucket 2: tiny.example (2) -> Other.
    assert.equal(points[0].Other, 5);
    assert.equal(points[1].Other, 2);

    // Nothing may go missing: the lines still add up to every session.
    const plotted = points.reduce(
      (sum, point) => sum + keys.reduce((inner, key) => inner + point[key], 0),
      0
    );
    assert.equal(plotted, BUCKETS.reduce((sum, b) => sum + b.sessions, 0));
  });

  test('a series missing from a bucket is filled with 0, not left undefined', () => {
    // Recharts draws a GAP for a missing key, which reads as "no data"
    // rather than the truth, which is "nobody arrived from there".
    const { points, keys } = buildTrafficSourceSeries(BUCKETS, SITE, ['Direct', 'Internal', 'google.com']);
    for (const point of points) {
      for (const key of keys) {
        assert.equal(typeof point[key], 'number', `${key} must be numeric in every point`);
      }
    }
    assert.equal(points[1]['google.com'], 0);
    assert.equal(points[1].Internal, 0);
  });

  test('an empty range yields no points and no series', () => {
    const { points, keys } = buildTrafficSourceSeries([], SITE, ['Direct']);
    assert.deepEqual(points, []);
    assert.deepEqual(keys, []);
  });

  test('zero-session buckets never create a point', () => {
    const { points } = buildTrafficSourceSeries(
      [{ bucket: new Date('2026-08-24T00:00:00Z'), referrer: null, sessions: 0 }],
      SITE,
      ['Direct']
    );
    assert.deepEqual(points, []);
  });
});
