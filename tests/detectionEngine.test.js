import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectProductConfig, detectOrderConfig, DetectionClassificationError } from '../src/services/trackingConfig/detectionEngine.js';
import * as cheerio from 'cheerio';

function value(field) {
  return field?.value;
}

describe('detectProductConfig — JSON-LD product page', () => {
  const HTML = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Product","name":"Rui Fish","sku":"p-99",
         "offers":{"@type":"Offer","price":"799.00","priceCurrency":"BDT"}}
      </script>
    </head><body>
      <nav>Home | Shop | About | Contact</nav>
      <h1 class="product-title">Rui Fish</h1>
      <p>Fresh river Rui fish, sourced daily from local fishermen. Rich in protein and Omega-3 fatty acids, perfect
      for a healthy family meal. Delivered same-day within city limits.</p>
      <span class="price">৳799.00</span>
      <button class="add-to-cart-btn" data-product-id="p-99">Add to Cart</button>
      <footer>© 2026 Example Fish Market. All rights reserved.</footer>
    </body></html>`;

  const result = detectProductConfig(HTML, 'https://shop.example.com/products/rui-fish');

  test('detects the URL trigger pattern from the path structure', () => {
    assert.equal(value(result.productUrlPattern), '/products/*');
  });

  test('detects the product name via JSON-LD cross-referenced against the visible element', () => {
    assert.equal(value(result.productNameSelector), 'h1.product-title');
    assert.equal(result.productNameSelector.confidence, 'high');
    assert.equal(result.productNameSelector.source, 'json-ld');
  });

  test('detects the product price and a working extraction regex', () => {
    assert.ok(value(result.productPriceSelector));
    assert.equal(value(result.productPriceRegex), '([\\d,]+\\.?\\d*)');
    const $ = cheerio.load(HTML);
    const extracted = new RegExp(value(result.productPriceRegex)).exec($(value(result.productPriceSelector)).text());
    assert.equal(extracted[1], '799.00');
  });

  test('detects the add-to-cart button', () => {
    assert.equal(value(result.addToCartSelector), 'button.add-to-cart-btn');
  });

  test('detects a DOM-based product id selector, not a URL param, when a data attribute is present elsewhere', () => {
    // The id is on the add-to-cart button in this fixture, discoverable
    // via the common data-product-id convention even without matching
    // JSON-LD sku exactly on the SAME element as name/price.
    assert.equal(result.productIdSource.value, 'selector');
  });
});

describe('detectProductConfig — no structured data, class/id conventions only', () => {
  const HTML = `
    <html><body>
      <nav>Home | Shop | About | Contact</nav>
      <div id="product-container">
        <h1>Katla Fish</h1>
        <p>Farm-raised Katla fish, cleaned and cut to order. A local favorite for curries and traditional dishes,
        available fresh throughout the week.</p>
        <div class="product-price-box"><span class="amount">450.00 Tk</span></div>
      </div>
      <button id="add-to-cart">Add to cart</button>
      <footer>© 2026 Example Fish Market. All rights reserved.</footer>
    </body></html>`;

  const result = detectProductConfig(HTML, 'https://shop.example.com/products/katla-fish');

  test('falls back to the page h1 for the name', () => {
    assert.ok(value(result.productNameSelector));
    const $ = cheerio.load(HTML);
    assert.equal($(value(result.productNameSelector)).text().trim(), 'Katla Fish');
  });

  test('falls back to a class-name heuristic for price, medium confidence', () => {
    assert.ok(value(result.productPriceSelector));
    assert.equal(result.productPriceSelector.confidence, 'medium');
  });

  test('finds the add-to-cart button by its own id', () => {
    assert.equal(value(result.addToCartSelector), '#add-to-cart');
  });
});

describe('detectProductConfig — nothing detectable', () => {
  test('returns an empty-ish result rather than inventing selectors', () => {
    const result = detectProductConfig(
      `<html><body>
        <nav>Home | Shop | About | Contact</nav>
        <p>Just some text, no ecommerce markup at all. We are a small local business founded in 2020, dedicated to
        quality and customer service. Feel free to reach out with any questions.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`,
      'https://shop.example.com/about'
    );
    assert.equal(result.productNameSelector, undefined);
    assert.equal(result.productPriceSelector, undefined);
    assert.equal(result.addToCartSelector, undefined);
    // URL pattern and the productIdSource default are still emitted —
    // they're structural facts, not guesses about page content.
    assert.equal(value(result.productUrlPattern), '/about');
  });
});

// Mirrors the user's own worked example almost exactly: a Bootstrap
// card-based order page with .card > p order id, .mt-3 h5 total, and a
// flex-row repeated item list.
describe('detectOrderConfig — Bootstrap order-confirmation page (matches the user\'s own example shape)', () => {
  const HTML = `
    <html><body>
      <nav>Home | Shop | My Orders | Account</nav>
      <div class="card">
        <h2>Thank you for your order!</h2>
        <p>Your order has been confirmed and is being processed. A confirmation email has been sent to you.</p>
        <p>Order ID: #4a15ae8f-0e38-40ae-bf40-9b26de6ed767</p>
        <div class="mt-3"><h5>Total: 2500.00 BDT</h5></div>
        <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-3">
          <h6>T-Shirt</h6>
          <p class="m-0">1500</p>
          <small class="text-muted">2</small>
        </div>
        <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-3">
          <h6>Shoes</h6>
          <p class="m-0">1000</p>
          <small class="text-muted">1</small>
        </div>
        <p>Shipping to: 123 Example Street, Dhaka. Estimated delivery in 3-5 business days.</p>
      </div>
      <footer>© 2026 Example Shop. All rights reserved. Contact us for any questions about your order.</footer>
    </body></html>`;

  const result = detectOrderConfig(HTML, 'https://shop.example.com/my-orders/4a15ae8f', 'BDT');

  test('detects the order URL trigger pattern', () => {
    assert.equal(value(result.orderTriggerUrlPattern), '/my-orders/*');
  });

  test('sources currency from the website settings, not page text', () => {
    assert.equal(value(result.orderCurrency), 'BDT');
    assert.equal(result.orderCurrency.source, 'website-settings');
  });

  test('detects the order id and a regex that actually extracts it', () => {
    assert.ok(value(result.orderIdSelector));
    const $ = cheerio.load(HTML);
    const text = $(value(result.orderIdSelector)).text();
    const extracted = new RegExp(value(result.orderIdRegex)).exec(text);
    assert.equal(extracted[1], '4a15ae8f-0e38-40ae-bf40-9b26de6ed767');
  });

  test('detects the order total and a regex that actually extracts it', () => {
    assert.ok(value(result.orderTotalSelector));
    const $ = cheerio.load(HTML);
    const text = $(value(result.orderTotalSelector)).text();
    const extracted = new RegExp(value(result.orderTotalRegex)).exec(text);
    assert.equal(extracted[1], '2500.00');
  });

  test('detects the repeating item container matching BOTH rows', () => {
    assert.ok(value(result.orderItemContainerSelector));
    const $ = cheerio.load(HTML);
    assert.equal($(value(result.orderItemContainerSelector)).length, 2);
  });

  test('detects item name/price/qty selectors that work relative to each row', () => {
    const $ = cheerio.load(HTML);
    const rows = $(value(result.orderItemContainerSelector));
    const names = rows.map((_, el) => $(el).find(value(result.orderItemNameSelector)).text().trim()).get();
    const prices = rows.map((_, el) => $(el).find(value(result.orderItemPriceSelector)).text().trim()).get();
    const qtys = rows.map((_, el) => $(el).find(value(result.orderItemQtySelector)).text().trim()).get();
    assert.deepEqual(names, ['T-Shirt', 'Shoes']);
    assert.deepEqual(prices, ['1500', '1000']);
    assert.deepEqual(qtys, ['2', '1']);
  });

  test('every generated item field is a CLEAN value — no regex needed, since none exists for item fields at runtime', () => {
    const $ = cheerio.load(HTML);
    const rows = $(value(result.orderItemContainerSelector));
    rows.each((_, row) => {
      const priceText = $(row).find(value(result.orderItemPriceSelector)).text().trim();
      const qtyText = $(row).find(value(result.orderItemQtySelector)).text().trim();
      assert.ok(Number.isFinite(Number(priceText.replace(/,/g, ''))), `price "${priceText}" must parse as a plain number`);
      assert.ok(Number.isFinite(Number(qtyText)), `qty "${qtyText}" must parse as a plain number`);
    });
  });
});

describe('detectOrderConfig — item id living directly on the row, not a descendant', () => {
  const HTML = `
    <html><body>
      <nav>Home | Shop | My Orders | Account</nav>
      <h2>Thank you for your order!</h2>
      <p>Order # ABC12345</p>
      <p>Order Total: 500 BDT</p>
      <div class="line-item" data-product-id="p-rui"><span class="name">Rui</span><span class="p">500</span></div>
      <div class="line-item" data-product-id="p-katla"><span class="name">Katla</span><span class="p">200</span></div>
      <p>We will notify you by email once your order has shipped. Thank you for shopping with us today.</p>
      <footer>© 2026 Example Shop. All rights reserved.</footer>
    </body></html>`;

  test('generates an attribute-presence selector that matches the row itself via the runtime\'s own-element check', () => {
    const result = detectOrderConfig(HTML, 'https://shop.example.com/my-orders/1', 'BDT');
    assert.equal(value(result.orderItemIdSelector), '[data-product-id]::attr(data-product-id)');
  });
});

describe('detectOrderConfig — no repeating items at all', () => {
  test('still detects order id/total, omits item fields rather than guessing', () => {
    const result = detectOrderConfig(
      `<html><body>
        <nav>Home | Shop | My Orders | Account</nav>
        <h2>Thank you for your order!</h2>
        <p>Order ID: #abc123</p>
        <p>Order Total: 100.00 USD</p>
        <p>Your order is being processed and you will receive a shipping confirmation email shortly.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`,
      'https://shop.example.com/my-orders/abc123',
      'USD'
    );
    assert.ok(value(result.orderIdSelector));
    assert.ok(value(result.orderTotalSelector));
    assert.equal(result.orderItemContainerSelector, undefined);
    assert.equal(result.orderItemNameSelector, undefined);
  });
});

// --- Page-shape classification (why detection failed, not just that it did) ---
//
// A silent empty result for "wrong kind of page entirely" (a listing grid,
// a login redirect, a near-empty JS shell) is indistinguishable from "this
// really is a product/order page with unusual markup" — these tests prove
// each wrong-page shape is caught and explained instead.

function assertClassification(fn, expectedReason) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof DetectionClassificationError);
    assert.equal(error.reason, expectedReason);
    assert.ok(error.message.length > 0);
    return true;
  });
}

describe('detectProductConfig — page-shape classification', () => {
  test('a product LISTING/grid page is rejected, not silently detected as empty', () => {
    const HTML = `
      <html><body>
        <nav>Home | Shop | About | Contact</nav>
        <h1>All Products</h1>
        <p>Browse our full selection of fresh, locally-sourced fish, delivered same-day within city limits.</p>
        <div class="product-grid">
          <div class="product-card"><a href="/products/rui">Rui Fish</a><span class="price">799.00</span></div>
          <div class="product-card"><a href="/products/katla">Katla Fish</a><span class="price">450.00</span></div>
          <div class="product-card"><a href="/products/hilsa">Hilsa Fish</a><span class="price">1200.00</span></div>
        </div>
        <footer>© 2026 Example Fish Market. All rights reserved.</footer>
      </body></html>`;
    assertClassification(() => detectProductConfig(HTML, 'https://shop.example.com/products'), 'listing_page');
  });

  test('a page with JSON-LD Product is NEVER classified as a listing, even alongside a repeated related-products grid', () => {
    const HTML = `
      <html><head>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Product","name":"Rui Fish","sku":"p-99",
           "offers":{"@type":"Offer","price":"799.00","priceCurrency":"BDT"}}
        </script>
      </head><body>
        <nav>Home | Shop | About | Contact</nav>
        <h1 class="product-title">Rui Fish</h1>
        <p>Fresh river Rui fish, sourced daily from local fishermen, rich in protein and Omega-3 fatty acids.</p>
        <span class="price">৳799.00</span>
        <h2>Related products</h2>
        <p>Customers who bought this also purchased the following fresh catches from our market this week.</p>
        <div class="related-grid">
          <div class="related-card"><a href="/products/katla">Katla</a><span class="p">450.00</span></div>
          <div class="related-card"><a href="/products/hilsa">Hilsa</a><span class="p">1200.00</span></div>
          <div class="related-card"><a href="/products/pabda">Pabda</a><span class="p">600.00</span></div>
        </div>
      </body></html>`;
    // Must not throw — JSON-LD Product is decisive evidence this IS a
    // single product page, regardless of the related-products grid below it.
    const result = detectProductConfig(HTML, 'https://shop.example.com/products/rui-fish');
    assert.equal(value(result.productNameSelector), 'h1.product-title');
  });

  test('a login/sign-in redirect page is rejected with a login-specific message', () => {
    const HTML = `
      <html><head><title>Sign In</title></head><body>
        <nav>Home | Shop | About | Contact</nav>
        <h1>Sign In</h1>
        <form>
          <label>Email <input type="email" name="email" /></label>
          <label>Password <input type="password" name="password" /></label>
          <button type="submit">Log In</button>
        </form>
        <p>Do not have an account? Register here to start shopping with us today.</p>
      </body></html>`;
    assertClassification(() => detectProductConfig(HTML, 'https://shop.example.com/auth/login/?next=/products/'), 'login_required');
  });

  test('an almost-empty JS-rendered shell is rejected with a JS-rendered-specific message', () => {
    const HTML = `
      <html><head>
        <script src="/static/bundle.js"></script>
        <script>window.__INITIAL_STATE__ = { loading: true };</script>
      </head><body>
        <div id="root"></div>
      </body></html>`;
    assertClassification(() => detectProductConfig(HTML, 'https://shop.example.com/products/rui-fish'), 'js_rendered_empty');
  });

  test('script/style content never counts toward the has-enough-visible-text check', () => {
    const HTML = `
      <html><head>
        <style>.product-title { font-size: 2rem; color: red; font-weight: bold; padding: 10px; margin: 5px; }</style>
        <script>console.log('this is a lot of script text that should never count as real page content at all');</script>
      </head><body>
        <div id="root"></div>
      </body></html>`;
    assertClassification(() => detectProductConfig(HTML, 'https://shop.example.com/products/rui-fish'), 'js_rendered_empty');
  });
});

describe('detectOrderConfig — page-shape classification', () => {
  test('a login/sign-in redirect page is rejected with an order-specific wording', () => {
    const HTML = `
      <html><head><title>Sign In</title></head><body>
        <nav>Home | Shop | My Orders | Account</nav>
        <h1>Sign In</h1>
        <form>
          <label>Email <input type="email" name="email" /></label>
          <label>Password <input type="password" name="password" /></label>
          <button type="submit">Log In</button>
        </form>
        <p>Please sign in to view your order history and account details.</p>
      </body></html>`;
    assertClassification(() => detectOrderConfig(HTML, 'https://shop.example.com/auth/login/?next=/my-orders/', 'BDT'), 'login_required');
  });

  test('an almost-empty JS-rendered shell is rejected', () => {
    const HTML = '<html><body><div id="root"></div></body></html>';
    assertClassification(() => detectOrderConfig(HTML, 'https://shop.example.com/my-orders/1', 'BDT'), 'js_rendered_empty');
  });

  test('a page with real content but no order signals at all is rejected with a clear reason', () => {
    const HTML = `
      <html><body>
        <nav>Home | Shop | About | Contact</nav>
        <h1>About Us</h1>
        <p>We are a small local business founded in 2020, dedicated to quality and customer service. Feel free
        to reach out with any questions about our products or services any time.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`;
    assertClassification(() => detectOrderConfig(HTML, 'https://shop.example.com/my-orders/1', 'BDT'), 'order_signals_missing');
  });

  test('generic order-ish wording alone avoids the order_signals_missing rejection, even without a clean id/total match', () => {
    const HTML = `
      <html><body>
        <nav>Home | Shop | My Orders | Account</nav>
        <h2>Order Confirmation</h2>
        <p>Thank you for your order! Your order summary and confirmation details have been emailed to you, and
        your order number can be found in that email for your reference.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`;
    // No id/total selector configured cleanly enough to detect, but the
    // page content itself is clearly order-shaped — must NOT throw.
    const result = detectOrderConfig(HTML, 'https://shop.example.com/my-orders/1', 'BDT');
    assert.equal(result.orderIdSelector, undefined);
  });

  test('a genuine order page with a class-named (not label-worded) id/total is still detected via its label text', () => {
    const HTML = `
      <html><body>
        <nav>Home | Shop | My Orders | Account</nav>
        <h2>Thank you for your order!</h2>
        <p>Order #: <span class="order-id">4a15ae8f-0e38-40ae-bf40-9b26de6ed767</span></p>
        <p>Total: <span class="order-total">2500.00 BDT</span></p>
        <p>We appreciate your business and will notify you once your items have shipped.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`;
    const result = detectOrderConfig(HTML, 'https://shop.example.com/my-orders/4a15ae8f', 'BDT');
    assert.ok(value(result.orderIdSelector));
    assert.ok(value(result.orderTotalSelector));
  });
});
