import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockReportingPipeline } from './helpers/mockReportingPipeline.js';
import { ssrfSafeFetch, DetectFetchError } from '../src/utils/ssrfSafeFetch.js';
import { signAuthToken } from '../src/utils/jwt.js';

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function post(websiteId, body, token) {
  return fetch(`${baseUrl}/api/config/${websiteId}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const PRODUCT_HTML = `<html><body>
  <nav>Home | Shop | About | Contact</nav>
  <h1 class="title">Rui Fish</h1>
  <p>Fresh river Rui fish, sourced daily from local fishermen. Rich in protein and Omega-3 fatty acids, perfect
  for a healthy family meal. Delivered same-day within city limits.</p>
  <span class="price">799.00</span>
  <footer>© 2026 Example Fish Market. All rights reserved. Contact us for bulk orders and delivery details.</footer>
</body></html>`;
const ORDER_HTML = `<html><body>
  <nav>Home | Shop | My Orders | Account</nav>
  <h2>Thank you for your order!</h2>
  <p>Order ID: #4a15ae8f</p>
  <p>Order Total: 799.00 BDT</p>
  <p>Your order is being processed and you will receive a confirmation email shortly.</p>
  <footer>© 2026 Example Fish Market. All rights reserved.</footer>
</body></html>`;

describe('POST /api/config/:websiteId/detect', () => {
  test('requires a valid JWT', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await post(pipeline.websiteId, { productUrl: 'https://shop.example.com/p/1' });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });

  test('a different authenticated user cannot detect config for a website they do not own', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { ownerId: 'owner-A' });
    t.mock.method((await import('../src/repositories/user.repository.js')).userRepository, 'findById', async (id) => {
      if (id === 'owner-A' || id === 'owner-B') return { _id: id, email: `${id}@x.com`, role: 'user', status: 'active' };
      return null;
    });
    const attackerToken = signAuthToken({ _id: 'owner-B', role: 'user' });

    const res = await post(pipeline.websiteId, { productUrl: 'https://shop.example.com/p/1' }, attackerToken);
    assert.equal(res.status, 404);
  });

  test('rejects a request with neither productUrl nor orderUrl', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await post(pipeline.websiteId, {}, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'DETECT_NO_URL_PROVIDED');
  });

  test('rejects a malformed productUrl', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const res = await post(pipeline.websiteId, { productUrl: 'not-a-url' }, pipeline.token);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'DETECT_INVALID_URL');
  });

  test('detects a product config from the fetched HTML (fetch itself mocked — this proves the route wiring, not the engine)', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', async (url) => ({ html: PRODUCT_HTML, finalUrl: url }));

    const res = await post(pipeline.websiteId, { productUrl: 'https://shop.example.com/products/rui-fish' }, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    // No DOM-based id in this fixture, so this falls back to a
    // parameterized URL pattern (see detectionEngine.js's detectProductId)
    // rather than the bare wildcard — extraction needs a ":id" to work.
    assert.equal(body.data.product.productUrlPattern.value, '/products/:id');
    assert.ok(body.data.product.productNameSelector);
    assert.deepEqual(body.data.order, {}); // orderUrl not supplied
  });

  test('orderCurrency is read from the page\'s own order total, agreeing with settings here', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { currency: 'BDT' });
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', async (url) => ({ html: ORDER_HTML, finalUrl: url }));

    const res = await post(pipeline.websiteId, { orderUrl: 'https://shop.example.com/my-orders/1' }, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.order.orderCurrency.value, 'BDT');
    assert.equal(body.data.order.orderCurrency.source, 'order-page');
  });

  test('a fetch failure on one side does not block the other side\'s result', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { currency: 'USD' });
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', async (url) => {
      if (url.includes('products')) throw new DetectFetchError('blocked', 'blocked for test');
      return { html: ORDER_HTML, finalUrl: url };
    });

    const res = await post(
      pipeline.websiteId,
      { productUrl: 'https://shop.example.com/products/x', orderUrl: 'https://shop.example.com/my-orders/1' },
      pipeline.token
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body.data.product, {});
    assert.equal(body.data.productError.reason, 'blocked');
    assert.ok(body.data.order.orderIdSelector);
  });

  test('never invents a field that could not actually be detected', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', async (url) => ({
      html: `<html><body>
        <nav>Home | Shop | About | Contact</nav>
        <p>Nothing ecommerce-shaped here — just a normal informational page describing the company history and
        mission, with enough text to look like a real page rather than an empty shell.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`,
      finalUrl: url,
    }));

    const res = await post(pipeline.websiteId, { productUrl: 'https://shop.example.com/about' }, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.product.productNameSelector, undefined);
    assert.equal(body.data.product.productPriceSelector, undefined);
    assert.equal(body.data.product.addToCartSelector, undefined);
  });

  test('rejects a listing/category-shaped productUrl before ever fetching it', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    const fetchMock = t.mock.fn(async () => {
      throw new Error('should never be called for a listing-shaped URL');
    });
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', fetchMock);

    const res = await post(pipeline.websiteId, { productUrl: 'https://shop.example.com/products/' }, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'DETECT_PRODUCT_URL_LOOKS_LIKE_LISTING');
    assert.match(body.message, /category\/listing URL/);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test('a bare-root productUrl is also rejected as listing-shaped', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', async () => {
      throw new Error('should never be called');
    });

    const res = await post(pipeline.websiteId, { productUrl: 'https://shop.example.com/' }, pipeline.token);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'DETECT_PRODUCT_URL_LOOKS_LIKE_LISTING');
  });

  test('a real single-product URL (two segments) is never rejected as listing-shaped', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', async (url) => ({ html: PRODUCT_HTML, finalUrl: url }));

    const res = await post(pipeline.websiteId, { productUrl: 'https://shop.example.com/products/rui-fish' }, pipeline.token);
    assert.equal(res.status, 200);
  });

  test('a page-shape classification failure (login redirect) surfaces its specific reason and message through the API', async (t) => {
    const pipeline = setupMockReportingPipeline(t);
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', async (url) => ({
      html: `<html><head><title>Sign In</title></head><body>
        <nav>Home | Shop | About | Contact</nav>
        <h1>Sign In</h1>
        <form>
          <label>Email <input type="email" name="email" /></label>
          <label>Password <input type="password" name="password" /></label>
          <button type="submit">Log In</button>
        </form>
        <p>Please sign in to continue shopping with us and view your saved items.</p>
      </body></html>`,
      finalUrl: url,
    }));

    const res = await post(pipeline.websiteId, { productUrl: 'https://shop.example.com/auth/login' }, pipeline.token);
    const body = await res.json();

    assert.equal(res.status, 200); // a per-side classification failure never fails the whole request
    assert.deepEqual(body.data.product, {});
    assert.equal(body.data.productError.reason, 'login_required');
    assert.match(body.data.productError.message, /require login|sign-in page/i);
  });
});
