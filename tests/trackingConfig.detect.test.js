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
    assert.equal(body.data.product.productUrlPattern.value, '/products/:id');
    assert.ok(body.data.product.productNameSelector);
    assert.deepEqual(body.data.order, {});
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

    assert.equal(res.status, 200);
    assert.deepEqual(body.data.product, {});
    assert.equal(body.data.productError.reason, 'login_required');
    assert.match(body.data.productError.message, /require login|sign-in page/i);
  });
});

describe('POST /api/config/:websiteId/detect — product identity is aligned across the two pages', () => {
  const WOO_PRODUCT = `<html><body>
    <nav>Home | Shop | About | Contact</nav>
    <h1 class="product_title">12-piece Tableware Set</h1>
    <p>A complete twelve-piece dinner service in glazed stoneware, dishwasher and microwave safe, suitable for
    everyday family meals as well as for entertaining guests at home throughout the year.</p>
    <p class="price"><span class="woocommerce-Price-amount amount">229.99</span></p>
    <form class="variations_form cart" data-product_id="191">
      <button type="submit" class="single_add_to_cart_button">Add to cart</button>
    </form>
    <footer>&copy; 2026 Academy. All rights reserved.</footer>
  </body></html>`;

  const WOO_ORDER = `<html><body>
    <nav>Shopping cart | Checkout | Order complete</nav>
    <p>Thank you. Your order has been received.</p>
    <ul class="woocommerce-order-overview">
      <li class="woocommerce-order-overview__order">Order number: <strong>48586</strong></li>
      <li class="woocommerce-order-overview__total">Total: <strong>289.99 BDT</strong></li>
    </ul>
    <table class="woocommerce-table--order-details">
      <tbody>
        <tr class="woocommerce-table__line-item order_item">
          <td class="product-name"><a href="/product/12-piece-tableware-set/">12-piece Tableware Set</a>
            <strong class="product-quantity">&times;&nbsp;1</strong></td>
          <td class="product-total"><span class="woocommerce-Price-amount">229.99</span></td>
        </tr>
        <tr class="woocommerce-table__line-item order_item">
          <td class="product-name"><a href="/product/ceramic-mug/">Ceramic Mug</a>
            <strong class="product-quantity">&times;&nbsp;3</strong></td>
          <td class="product-total"><span class="woocommerce-Price-amount">60.00</span></td>
        </tr>
      </tbody>
    </table>
    <footer>&copy; 2026 Academy. All rights reserved.</footer>
  </body></html>`;

  function serveBoth(t) {
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', async (url) => ({
      html: url.includes('order-received') ? WOO_ORDER : WOO_PRODUCT,
      finalUrl: url,
    }));
  }

  async function detectBoth(t, ownerId) {
    const pipeline = setupMockReportingPipeline(t, { currency: 'BDT', ownerId });
    serveBoth(t);
    const res = await post(
      pipeline.websiteId,
      {
        productUrl: 'https://academy.example.com/product/12-piece-tableware-set/',
        orderUrl: 'https://academy.example.com/checkout/order-received/48586/',
      },
      pipeline.token
    );
    assert.equal(res.status, 200);
    return (await res.json()).data;
  }

  test('order line items are identified by their product link when no id attribute exists', async (t) => {
    const data = await detectBoth(t, 'align-owner-1');
    assert.equal(data.order.orderItemIdSelector.source, 'product-link');
    assert.match(data.order.orderItemIdSelector.value, /::attr\(href\)$/);
  });

  test('the product page is switched to URL ids, because the order page can only produce those', async (t) => {
    const data = await detectBoth(t, 'align-owner-2');
    assert.equal(data.product.productIdSource.value, 'url');
    assert.equal(data.product.productIdSource.source, 'aligned-with-order-items');
    assert.equal(data.product.productIdSelector, undefined, 'the unused selector must not be saved');
  });

  test('detecting the product page ALONE keeps its own DOM id — alignment only applies when both pages are known', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { currency: 'BDT', ownerId: 'align-owner-3' });
    serveBoth(t);
    const res = await post(
      pipeline.websiteId,
      { productUrl: 'https://academy.example.com/product/12-piece-tableware-set/' },
      pipeline.token
    );
    const { data } = await res.json();

    assert.equal(data.product.productIdSource.value, 'selector');
    assert.match(data.product.productIdSelector.value, /data-product_id/);
  });

  test('an order page WITH real id attributes leaves the product page selector alone', async (t) => {
    const pipeline = setupMockReportingPipeline(t, { currency: 'BDT', ownerId: 'align-owner-4' });
    const withIds = WOO_ORDER.replaceAll(
      '<tr class="woocommerce-table__line-item order_item">',
      '<tr class="woocommerce-table__line-item order_item" data-product-id="191">'
    );
    t.mock.method(ssrfSafeFetch, 'fetchHtmlSafely', async (url) => ({
      html: url.includes('order-received') ? withIds : WOO_PRODUCT,
      finalUrl: url,
    }));

    const res = await post(
      pipeline.websiteId,
      {
        productUrl: 'https://academy.example.com/product/12-piece-tableware-set/',
        orderUrl: 'https://academy.example.com/checkout/order-received/48586/',
      },
      pipeline.token
    );
    const { data } = await res.json();

    assert.equal(data.order.orderItemIdSelector.value, '[data-product-id]::attr(data-product-id)');
    assert.notEqual(data.order.orderItemIdSelector.source, 'product-link');
    assert.equal(data.product.productIdSource.value, 'selector', 'both pages can produce the DOM id — nothing to align');
    assert.match(data.product.productIdSelector.value, /data-product_id/);
  });
});
