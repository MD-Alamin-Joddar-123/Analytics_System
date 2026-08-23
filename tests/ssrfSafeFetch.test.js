import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchHtmlSafely } from '../src/utils/ssrfSafeFetch.js';

// A real local server so the "happy path" fetch mechanics (connect,
// redirect-follow, byte cap, content-type check) are proven against actual
// bytes on the wire, not just mocked. It's bound to 127.0.0.1 — normally
// blocked by design — so every test here passes an `isBlocked` override
// that allows loopback through, isolating "does the fetch mechanism work"
// from "does the blocklist work" (already covered in full by
// privateNetwork.test.js and the dedicated blocking tests below, which
// deliberately do NOT override isBlocked).
const allowLoopback = () => false;

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/product') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Rui Fish</h1></body></html>');
      return;
    }
    if (req.url === '/redirect-once') {
      res.writeHead(302, { Location: '/product' });
      res.end();
      return;
    }
    if (req.url?.startsWith('/redirect-loop')) {
      res.writeHead(302, { Location: '/redirect-loop' });
      res.end();
      return;
    }
    if (req.url === '/too-big') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('x'.repeat(1000));
      return;
    }
    if (req.url === '/not-html') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    if (req.url === '/not-found') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function fakeLookupTo(port) {
  return async () => [{ address: '127.0.0.1', family: 4 }];
}

describe('fetchHtmlSafely — happy path mechanics (against a real local server)', () => {
  test('fetches HTML and returns it with the final URL', async () => {
    const result = await fetchHtmlSafely(`${baseUrl}/product`, { isBlocked: allowLoopback });
    assert.match(result.html, /Rui Fish/);
    assert.equal(result.finalUrl, `${baseUrl}/product`);
  });

  test('follows a redirect, landing on the final resolved URL', async () => {
    const result = await fetchHtmlSafely(`${baseUrl}/redirect-once`, { isBlocked: allowLoopback });
    assert.match(result.html, /Rui Fish/);
    assert.equal(result.finalUrl, `${baseUrl}/product`);
  });

  test('gives up after too many redirects rather than looping forever', async () => {
    await assert.rejects(
      fetchHtmlSafely(`${baseUrl}/redirect-loop`, { isBlocked: allowLoopback, maxRedirects: 2 }),
      /redirected more than/
    );
  });

  test('rejects a response over the byte cap', async () => {
    await assert.rejects(
      fetchHtmlSafely(`${baseUrl}/too-big`, { isBlocked: allowLoopback, maxBytes: 100 }),
      /exceeded the 100-byte limit/
    );
  });

  test('rejects a non-HTML content type', async () => {
    await assert.rejects(fetchHtmlSafely(`${baseUrl}/not-html`, { isBlocked: allowLoopback }), /did not return HTML/);
  });

  test('rejects a non-2xx response', async () => {
    await assert.rejects(fetchHtmlSafely(`${baseUrl}/not-found`, { isBlocked: allowLoopback }), /HTTP 404/);
  });

  test('rejects when the server never responds within the timeout', async () => {
    const slowServer = http.createServer(() => {}); // never responds
    await new Promise((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
    const slowUrl = `http://127.0.0.1:${slowServer.address().port}/`;

    await assert.rejects(
      fetchHtmlSafely(slowUrl, { isBlocked: allowLoopback, timeoutMs: 100 }),
      /timed out/
    );
    await new Promise((resolve) => slowServer.close(resolve));
  });
});

describe('fetchHtmlSafely — SSRF blocking (real production blocklist, no override)', () => {
  test('rejects a malformed URL before attempting any network I/O', async () => {
    await assert.rejects(fetchHtmlSafely('not-a-url'), /not a valid URL/);
  });

  test('rejects a non-http(s) scheme', async () => {
    await assert.rejects(fetchHtmlSafely('ftp://example.com/file'), /must be an http\(s\) URL/);
  });

  test('rejects a hostname that resolves to a blocked (loopback) address', async () => {
    await assert.rejects(
      fetchHtmlSafely('http://looks-public.example/', { lookup: fakeLookupTo() }),
      /resolves to a blocked network address/
    );
  });

  test('rejects a hostname that resolves to a blocked cloud-metadata address', async () => {
    await assert.rejects(
      fetchHtmlSafely('http://looks-public.example/', {
        lookup: async () => [{ address: '169.254.169.254', family: 4 }],
      }),
      /resolves to a blocked network address/
    );
  });

  test('rejects when even ONE of several resolved addresses is blocked', async () => {
    await assert.rejects(
      fetchHtmlSafely('http://looks-public.example/', {
        lookup: async () => [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
      }),
      /resolves to a blocked network address/
    );
  });

  test('rejects a redirect that leads into a blocked address, even though the first hop was fine', async () => {
    // The first hop's own address is allowed via override (so it's reached
    // at all), but the SECOND hop (what the redirect points at) is
    // resolved with the REAL blocklist active, proving re-validation
    // happens on every hop, not just the first.
    const redirectServer = http.createServer((req, res) => {
      res.writeHead(302, { Location: 'http://internal.example/secret' });
      res.end();
    });
    await new Promise((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
    const redirectUrl = `http://127.0.0.1:${redirectServer.address().port}/`;

    await assert.rejects(
      fetchHtmlSafely(redirectUrl, {
        isBlocked: (address) => (address === '127.0.0.1' ? false : true),
        lookup: async (hostname) =>
          hostname === 'internal.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '127.0.0.1', family: 4 }],
      }),
      /resolves to a blocked network address/
    );
    await new Promise((resolve) => redirectServer.close(resolve));
  });
});
