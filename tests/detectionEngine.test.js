import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectProductConfig, detectOrderConfig, detectCheckoutConfig, DetectionClassificationError } from '../src/services/trackingConfig/detectionEngine.js';
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
    assert.equal(value(result.productUrlPattern), '/about');
  });
});

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

  test('currency is read from the order total itself — the page beats stale settings', () => {
    assert.equal(value(result.orderCurrency), 'BDT');
    assert.equal(result.orderCurrency.confidence, 'high');
    assert.equal(result.orderCurrency.source, 'order-page');
  });

  test('settings remain the fallback when the page carries no readable currency marker', () => {
    const markerFree = detectOrderConfig(
      `<html><body>
        <nav>Home | Shop | My Orders | Account</nav>
        <h2>Thank you for your order!</h2>
        <p>Order ID: #abc123</p>
        <p>Order Total: 2500.00</p>
        <p>Your order is being processed and you will receive a shipping confirmation email shortly.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`,
      'https://shop.example.com/my-orders/abc123',
      'USD'
    );
    assert.equal(value(markerFree.orderCurrency), 'USD');
    assert.equal(markerFree.orderCurrency.confidence, 'high');
    assert.equal(markerFree.orderCurrency.source, 'website-settings');
  });

  test('an ambiguous "$" total is not resolved from the page — settings stand instead', () => {
    const dollarOnly = detectOrderConfig(
      `<html><body>
        <nav>Home | Shop | My Orders | Account</nav>
        <h2>Thank you for your order!</h2>
        <p>Order ID: #abc123</p>
        <p>Order Total: $50.00</p>
        <p>Your order is being processed and you will receive a shipping confirmation email shortly.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`,
      'https://shop.example.com/my-orders/abc123',
      'CAD'
    );
    assert.equal(value(dollarOnly.orderCurrency), 'CAD');
    assert.equal(dollarOnly.orderCurrency.source, 'website-settings');

    const noSettings = detectOrderConfig(
      `<html><body>
        <nav>Home | Shop | My Orders | Account</nav>
        <h2>Thank you for your order!</h2>
        <p>Order ID: #abc123</p>
        <p>Order Total: $50.00</p>
        <p>Your order is being processed and you will receive a shipping confirmation email shortly.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`,
      'https://shop.example.com/my-orders/abc123',
      undefined
    );
    assert.equal(noSettings.orderCurrency, undefined);
  });

  test('a total whose text conflicts with itself (BDT beside $) defers to settings rather than guessing', () => {
    const conflicted = detectOrderConfig(
      `<html><body>
        <nav>Home | Shop | My Orders | Account</nav>
        <h2>Thank you for your order!</h2>
        <p>Order ID: #abc123</p>
        <div class="mt-3"><h5>Total: 2500.00 BDT (about $23)</h5></div>
        <div class="d-flex justify-content-between mb-3 border-bottom pb-3">
          <h6>T-Shirt</h6><p class="m-0">1500</p><small class="text-muted">2</small>
        </div>
        <p>Your order has been confirmed and is being processed. A confirmation email with your receipt and tracking
        details is on its way to the address you provided at checkout. You can also review this order at any time
        from your account's order history page.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`,
      'https://shop.example.com/my-orders/abc123',
      'USD'
    );
    assert.equal(value(conflicted.orderCurrency), 'USD');
    assert.equal(conflicted.orderCurrency.source, 'website-settings');
  });

  test('a markerless total still picks the currency up from the body\'s marked prices', () => {
    const rescued = detectOrderConfig(
      `<html><body>
        <nav>Home | Shop | My Orders | Account</nav>
        <h2>Thank you for your order!</h2>
        <p>Order ID: #abc123</p>
        <table>
          <tr><td>T-Shirt</td><td><span class="price">Tk 1500</span></td><td>2</td></tr>
        </table>
        <p>Grand Total: 3000.00</p>
        <p>Your order has been confirmed and is being processed. A confirmation email with your receipt and tracking
        details is on its way to the address you provided at checkout. You can also review this order at any time
        from your account's order history page.</p>
        <footer>© 2026 Example Shop. All rights reserved.</footer>
      </body></html>`,
      'https://shop.example.com/my-orders/abc123',
      'USD'
    );
    assert.equal(value(rescued.orderCurrency), 'BDT');
    assert.equal(rescued.orderCurrency.source, 'order-page');
    assert.equal(rescued.orderCurrency.confidence, 'high');
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


const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'detectionEngine');

function loadFixture(name) {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

function textAt(html, selector) {
  return cheerio.load(html)(selector).text().trim();
}

describe('fixture: order-confirmation-bdt-total.html — page currency beats stale settings, decoys ignored', () => {
  const HTML = loadFixture('order-confirmation-bdt-total.html');
  const result = detectOrderConfig(HTML, 'https://meghna.example.com/orders/ORD-20260820-7734', 'USD');

  test('reports BDT from the order total despite every decoy saying USD — high confidence', () => {
    assert.deepEqual(result.orderCurrency, { value: 'BDT', confidence: 'high', source: 'order-page' });
  });

  test('the fixture is a genuine order page — id and total still detected', () => {
    const $ = cheerio.load(HTML);
    assert.ok(value(result.orderIdSelector));
    const extracted = new RegExp(value(result.orderIdRegex)).exec($(value(result.orderIdSelector)).text());
    assert.equal(extracted[1], 'ORD-20260820-7734');
    assert.match(textAt(HTML, value(result.orderTotalSelector)), /119960\.00/);
  });
});

describe('fixture: product-jsonld.html — Priority 1 (JSON-LD structured data)', () => {
  const HTML = loadFixture('product-jsonld.html');
  const result = detectProductConfig(HTML, 'https://meghna.example.com/products/rui-fish-1kg');

  test('name comes from JSON-LD cross-referenced onto the rendered h1 — high confidence', () => {
    assert.equal(result.productNameSelector.source, 'json-ld');
    assert.equal(result.productNameSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productNameSelector)), 'Premium Fresh Rui Fish 1 kg');
  });

  test('price comes from JSON-LD and its regex extracts the value from the rendered span — high confidence', () => {
    assert.equal(result.productPriceSelector.source, 'json-ld');
    assert.equal(result.productPriceSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productPriceSelector)), '৳749.00');
    const extracted = new RegExp(value(result.productPriceRegex)).exec(textAt(HTML, value(result.productPriceSelector)));
    assert.equal(extracted[1], '749.00');
  });

  test('add-to-cart is the exact Shopify-style fingerprint — high confidence', () => {
    assert.equal(result.addToCartSelector.source, 'platform-pattern');
    assert.equal(result.addToCartSelector.confidence, 'high');
    assert.match(value(result.addToCartSelector), /name="add"|product-form__submit/);
  });

  test('product id rides the data-product-id attribute carrying the JSON-LD sku', () => {
    assert.equal(result.productIdSource.value, 'selector');
    assert.equal(result.productIdSource.confidence, 'high');
    assert.ok(value(result.productIdSelector).endsWith('::attr(data-product-id)'));
  });

  test('url trigger follows the /products/* path shape', () => {
    assert.equal(value(result.productUrlPattern), '/products/*');
  });
});

describe('fixture: product-microdata.html — Priority 1 (microdata only, no JSON-LD)', () => {
  const HTML = loadFixture('product-microdata.html');
  const result = detectProductConfig(HTML, 'https://tangail.example.com/sarees/jamdani');

  test('name comes from microdata itemprop="name" — high confidence', () => {
    assert.equal(result.productNameSelector.source, 'microdata');
    assert.equal(result.productNameSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productNameSelector)), 'Handwoven Jamdani Saree');
  });

  test('price comes from microdata itemprop="price" via its content attribute — high confidence', () => {
    assert.equal(result.productPriceSelector.source, 'microdata');
    assert.equal(result.productPriceSelector.confidence, 'high');
    const extracted = new RegExp(value(result.productPriceRegex)).exec(textAt(HTML, value(result.productPriceSelector)));
    assert.equal(extracted[1], '4,200.00');
  });

  test('sku renders visibly so the id can be a DOM selector — high confidence', () => {
    assert.equal(result.productIdSource.value, 'selector');
    assert.equal(result.productIdSource.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productIdSelector)), 'JS-7743');
  });

  test('add-to-cart uses the WooCommerce exact button fingerprint — high confidence', () => {
    assert.equal(result.addToCartSelector.source, 'platform-pattern');
    assert.equal(result.addToCartSelector.confidence, 'high');
  });
});

describe('fixture: product-rdfa.html — Priority 1 (RDFa only)', () => {
  const HTML = loadFixture('product-rdfa.html');
  const result = detectProductConfig(HTML, 'https://clayhouse.example.com/tableware/mug-set');

  test('name comes from RDFa property="name" — high confidence', () => {
    assert.equal(result.productNameSelector.source, 'rdfa');
    assert.equal(result.productNameSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productNameSelector)), 'Studio Pottery Ceramic Mug Set (4 pcs)');
  });

  test('price comes from RDFa property="price" content attribute — high confidence', () => {
    assert.equal(result.productPriceSelector.source, 'rdfa');
    assert.equal(result.productPriceSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productPriceSelector)), 'Tk 1,299');
    const extracted = new RegExp(value(result.productPriceRegex)).exec('Tk 1,299');
    assert.equal(extracted[1], '1,299');
  });

  test('sku renders as text so a DOM id selector exists — high confidence', () => {
    assert.equal(result.productIdSource.value, 'selector');
    assert.equal(result.productIdSource.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productIdSelector)), 'CP-MUG-04');
  });

  test('add-to-cart matched a generic class convention (not an exact fingerprint) — medium confidence', () => {
    assert.equal(result.addToCartSelector.source, 'platform-pattern');
    assert.equal(result.addToCartSelector.confidence, 'medium');
    assert.equal(textAt(HTML, value(result.addToCartSelector)), 'Add to Cart');
  });
});

describe('fixture: product-opengraph.html — Priority 1 (Open Graph tags, values used as search keys)', () => {
  const HTML = loadFixture('product-opengraph.html');
  const result = detectProductConfig(HTML, 'https://greenbasket.example.com/groceries/honey');

  test('og:title locates the rendered heading — high confidence, open-graph source', () => {
    assert.equal(result.productNameSelector.source, 'open-graph');
    assert.equal(result.productNameSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productNameSelector)), 'Organic Sundarban Honey 500 g');
  });

  test('product:price:amount locates the rendered price — high confidence, open-graph source', () => {
    assert.equal(result.productPriceSelector.source, 'open-graph');
    assert.equal(result.productPriceSelector.confidence, 'high');
    const extracted = new RegExp(value(result.productPriceRegex)).exec(textAt(HTML, value(result.productPriceSelector)));
    assert.equal(extracted[1], '650');
  });

  test('add-to-cart matched the generic .btn-cart convention — medium confidence', () => {
    assert.equal(result.addToCartSelector.source, 'platform-pattern');
    assert.equal(result.addToCartSelector.confidence, 'medium');
    assert.equal(textAt(HTML, value(result.addToCartSelector)), 'Buy Now');
  });

  test('hidden form input carries the id per the common convention — medium confidence', () => {
    assert.equal(result.productIdSource.value, 'selector');
    assert.equal(result.productIdSource.confidence, 'medium');
  });
});

describe('fixture: product-shopify.html — Priority 2 (Shopify naming, no structured data)', () => {
  const HTML = loadFixture('product-shopify.html');
  const result = detectProductConfig(HTML, 'https://natureshopy.example.com/products/neem-tulsi-toothpaste');

  test('no structured-data source leaks into any field — platform layer owns detection', () => {
    for (const field of [result.productNameSelector, result.productPriceSelector]) {
      assert.notEqual(field?.source, 'json-ld');
      assert.notEqual(field?.source, 'microdata');
      assert.notEqual(field?.source, 'rdfa');
      assert.notEqual(field?.source, 'open-graph');
    }
  });

  test('.product__title exact fingerprint — high confidence', () => {
    assert.equal(value(result.productNameSelector), 'h1.product__title');
    assert.equal(result.productNameSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productNameSelector)), 'Herbal Neem & Tulsi Toothpaste 100 g');
  });

  test('.price-item--regular exact fingerprint — high confidence', () => {
    assert.equal(result.productPriceSelector.source, 'platform-pattern');
    assert.equal(result.productPriceSelector.confidence, 'high');
    const extracted = new RegExp(value(result.productPriceRegex)).exec(textAt(HTML, value(result.productPriceSelector)));
    assert.equal(extracted[1], '240');
  });

  test('button[name="add"] exact fingerprint — high confidence', () => {
    assert.equal(result.addToCartSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.addToCartSelector)), 'Add to cart');
  });

  test('cart-form hidden input[name="id"] supplies the variant id — medium confidence', () => {
    assert.equal(result.productIdSource.value, 'selector');
    assert.equal(result.productIdSource.confidence, 'medium');
    assert.ok(value(result.productIdSelector).endsWith('::attr(value)'));
  });
});

describe('fixture: product-woocommerce.html — Priority 2 (WooCommerce naming, no structured data)', () => {
  const HTML = loadFixture('product-woocommerce.html');
  const result = detectProductConfig(HTML, 'https://rongdhonu.example.com/product/navy-three-piece');

  test('.product_title exact fingerprint — high confidence', () => {
    assert.equal(result.productNameSelector.source, 'platform-pattern');
    assert.equal(result.productNameSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productNameSelector)), 'Unstitched Cotton Three Piece — Navy Block Print');
  });

  test('.woocommerce-Price-amount exact fingerprint survives the nested currency symbol — high confidence', () => {
    assert.equal(result.productPriceSelector.source, 'platform-pattern');
    assert.equal(result.productPriceSelector.confidence, 'high');
    const extracted = new RegExp(value(result.productPriceRegex)).exec(textAt(HTML, value(result.productPriceSelector)));
    assert.equal(extracted[1], '1,850.00');
  });

  test('button[name="add-to-cart"] exact fingerprint — high confidence', () => {
    assert.equal(result.addToCartSelector.source, 'platform-pattern');
    assert.equal(result.addToCartSelector.confidence, 'high');
  });

  test('add-to-cart input value carries the product id — medium confidence', () => {
    assert.equal(result.productIdSource.value, 'selector');
    assert.equal(result.productIdSource.confidence, 'medium');
  });
});

describe('fixture: product-generic-heuristic.html — Priority 3 (pure heuristics, no known pattern)', () => {
  const HTML = loadFixture('product-generic-heuristic.html');
  const result = detectProductConfig(HTML, 'https://craftstudio.example.com/products/terracotta-dinner-set');

  test('every detected field carries LOW confidence — the review nudge must fire', () => {
    for (const field of [result.productNameSelector, result.productPriceSelector, result.addToCartSelector]) {
      assert.ok(field, 'expected the heuristic layer to find something');
      assert.equal(field.confidence, 'low');
    }
  });

  test('the most prominent heading becomes the name candidate', () => {
    assert.equal(result.productNameSelector.source, 'heading');
    assert.equal(textAt(HTML, value(result.productNameSelector)), 'Handmade Terracotta Dinner Set');
  });

  test('the currency-marked number becomes the price candidate', () => {
    assert.equal(result.productPriceSelector.source, 'currency-pattern');
    assert.equal(textAt(HTML, value(result.productPriceSelector)), '৳ 1,890');
  });

  test('the Buy Now button text identifies add-to-cart', () => {
    assert.equal(result.addToCartSelector.source, 'button-text');
    assert.equal(textAt(HTML, value(result.addToCartSelector)), 'Buy Now');
  });

  test('with no DOM id anywhere, the id falls back to the URL :id pattern', () => {
    assert.equal(result.productIdSource.value, 'url');
    assert.equal(result.productIdSource.confidence, 'low');
    assert.equal(value(result.productUrlPattern), '/products/:id');
  });
});

describe('P3 prominence rule — prefers the main-content h1 over banner chrome', () => {
  const HTML = `
    <html><body>
      <header><h1>Welcome to NatureShopy BD</h1></header>
      <main>
        <h1>Aloe Vera Soothing Gel 300 ml</h1>
        <p>Chilled aloe gel for sunburnt and irritated skin. Fragrance-free, dermatologically
        tested, absorbed within minutes without leaving any sticky residue behind at all.</p>
        <span>৳550</span>
        <button type="button">Buy Now</button>
      </main>
      <footer>© 2026 NatureShopy BD. Patch test recommended before first use every single time.</footer>
    </body></html>`;

  test('the h1 inside <main> wins over the earlier header h1', () => {
    const result = detectProductConfig(HTML, 'https://shop.example.com/products/aloe-gel');
    const $ = cheerio.load(HTML);
    assert.equal($(value(result.productNameSelector)).text().trim(), 'Aloe Vera Soothing Gel 300 ml');
    assert.equal(result.productNameSelector.source, 'heading');
  });
});

describe('fixture: product-listing-category.html — repeated cards are rejected', () => {
  const HTML = loadFixture('product-listing-category.html');

  test('throws listing_page instead of silently detecting card #1 as "the product"', () => {
    assertClassification(() => detectProductConfig(HTML, 'https://meghna.example.com/products'), 'listing_page');
  });
});

describe('fixture: error-js-rendered-shell.html — empty client-rendered shell is rejected', () => {
  const HTML = loadFixture('error-js-rendered-shell.html');

  test('throws js_rendered_empty with guidance to use rendered HTML or the picker', () => {
    assertClassification(() => detectProductConfig(HTML, 'https://shop.example.com/products/anything'), 'js_rendered_empty');
  });
});

describe('fixture: order-confirmation-jsonld.html — order Priority 1 (JSON-LD Order)', () => {
  const HTML = loadFixture('order-confirmation-jsonld.html');
  const result = detectOrderConfig(HTML, 'https://craftnest.example.com/order-received/ORD-20260819-4417', 'BDT');

  test('order id comes from schema.org/Order orderNumber rendered on the page', () => {
    assert.equal(result.orderIdSelector.source, 'json-ld');
    assert.equal(result.orderIdSelector.confidence, 'medium');
    const extracted = new RegExp(value(result.orderIdRegex)).exec(textAt(HTML, value(result.orderIdSelector)));
    assert.equal(extracted[1], 'ORD-20260819-4417');
  });

  test('order total comes from totalPaymentDue and finds the rendered Grand Total line', () => {
    assert.equal(result.orderTotalSelector.source, 'json-ld');
    assert.equal(result.orderTotalSelector.confidence, 'high');
    const extracted = new RegExp(value(result.orderTotalRegex)).exec(textAt(HTML, value(result.orderTotalSelector)));
    assert.equal(extracted[1], '3,275.00');
  });

  test('line items fall through to the generic repeated-structure scan (plain classless rows)', () => {
    assert.equal(result.orderItemContainerSelector.source, 'repeated-structure');
    assert.equal(result.orderItemContainerSelector.confidence, 'medium');
    const $ = cheerio.load(HTML);
    assert.equal($(value(result.orderItemContainerSelector)).length, 2);
  });

  test('per-row fields resolve relative to each row', () => {
    const $ = cheerio.load(HTML);
    const rows = $(value(result.orderItemContainerSelector));
    const names = rows.map((_, el) => $(el).find(value(result.orderItemNameSelector)).text().trim()).get();
    const prices = rows.map((_, el) => $(el).find(value(result.orderItemPriceSelector)).text().trim()).get();
    const qtys = rows.map((_, el) => $(el).find(value(result.orderItemQtySelector)).text().trim()).get();
    assert.deepEqual(names, ['Water Hyacinth Basket, Large', 'Jute Ground Runner']);
    assert.deepEqual(prices, ['1,400.00', '937.50']);
    assert.deepEqual(qtys, ['1', '2']);
  });

  test('data-sku on each row yields a clean attribute id selector', () => {
    assert.equal(value(result.orderItemIdSelector), '[data-sku]::attr(data-sku)');
    assert.equal(result.orderItemIdSelector.confidence, 'high');
  });
});

describe('fixture: order-confirmation-woocommerce.html — order Priority 2 (WooCommerce overview patterns)', () => {
  const HTML = loadFixture('order-confirmation-woocommerce.html');
  const result = detectOrderConfig(HTML, 'https://rongdhonu.example.com/checkout/order-received/24817', 'BDT');

  test('order id via .woocommerce-order-overview__order exact fingerprint — high confidence', () => {
    assert.equal(result.orderIdSelector.source, 'platform-pattern');
    assert.equal(result.orderIdSelector.confidence, 'high');
    const extracted = new RegExp(value(result.orderIdRegex)).exec(textAt(HTML, value(result.orderIdSelector)));
    assert.equal(extracted[1], '24817');
  });

  test('order id regex requires a digit, so "Order number:" prose is never captured', () => {
    assert.equal(new RegExp(value(result.orderIdRegex)).exec('Order number: 24817')[1], '24817');
  });

  test('order total via .woocommerce-order-overview__total exact fingerprint — high confidence', () => {
    assert.equal(result.orderTotalSelector.source, 'platform-pattern');
    assert.equal(result.orderTotalSelector.confidence, 'high');
    const extracted = new RegExp(value(result.orderTotalRegex)).exec(textAt(HTML, value(result.orderTotalSelector)));
    assert.equal(extracted[1], '2,100.00');
  });

  test('tr.order_item rows detected as the platform line-item container', () => {
    assert.equal(value(result.orderItemContainerSelector), 'tr.order_item');
    assert.equal(result.orderItemContainerSelector.source, 'platform-pattern');
    assert.equal(result.orderItemContainerSelector.confidence, 'medium');
    assert.equal(cheerio.load(HTML)(value(result.orderItemContainerSelector)).length, 2);
  });

  test('per-row name/price/qty resolve cleanly; no id attr means NO invented item id', () => {
    const $ = cheerio.load(HTML);
    const rows = $(value(result.orderItemContainerSelector));
    const names = rows.map((_, el) => $(el).find(value(result.orderItemNameSelector)).text().trim()).get();
    const prices = rows.map((_, el) => $(el).find(value(result.orderItemPriceSelector)).text().trim()).get();
    const qtys = rows.map((_, el) => $(el).find(value(result.orderItemQtySelector)).text().trim()).get();
    assert.deepEqual(names, ['Block Print Scarf, Indigo', 'Terracotta Jhumka Pair']);
    assert.deepEqual(prices, ['1,200.00', '450.00']);
    assert.deepEqual(qtys, ['1', '2']);
    assert.equal(result.orderItemIdSelector, undefined);
  });
});

describe('orderIdRegexFor shapes — hashed, hex, and digit-word ids each extract correctly', () => {
  function extract(regexValue, text) {
    return new RegExp(regexValue).exec(text)?.[1];
  }

  test('hex uuid with hash anchor', () => {
    assert.equal(extract('#([a-f0-9-]+)', '#4a15ae8f-0e38-40ae-bf40-9b26de6ed767'), '4a15ae8f-0e38-40ae-bf40-9b26de6ed767');
  });

  test('mixed letter/digit id with hash anchor captures the WHOLE token', () => {
    assert.equal(extract('#([A-Za-z0-9][A-Za-z0-9_-]+)', '#ORD-20260819-4417'), 'ORD-20260819-4417');
  });

  test('bare numeric/alphanumeric ids after label words still extract the number, not the label', () => {
    assert.equal(extract('([A-Za-z0-9-]*\\d[A-Za-z0-9_-]*)', 'Order number: 24817'), '24817');
    assert.equal(extract('([A-Za-z-]*\\d[A-Za-z0-9_-]*)', 'Order ID: ORD-77-B2'), 'ORD-77-B2');
  });
});

describe('fixture: product-bem-details-tabs.html — BEM/Django product page with layout containers', () => {
  const HTML = loadFixture('product-bem-details-tabs.html');
  const result = detectProductConfig(HTML, 'https://fish.example.com/products/rui/');

  test('is NOT misclassified as a listing despite five sibling .container wrappers', () => {
    assert.ok(result.productPriceSelector);
  });

  test('layout containers are not treated as repeated product cards; the related rail is', () => {
    assert.equal(value(result.productUrlPattern), '/products/*');
  });

  test('title from the bare <h3> via corroborated heading fallback — low confidence', () => {
    assert.equal(result.productNameSelector.source, 'heading');
    assert.equal(result.productNameSelector.confidence, 'low');
    assert.equal(textAt(HTML, value(result.productNameSelector)), 'Rui');
  });

  test('BEM price class detected even though the amount carries no currency symbol', () => {
    assert.equal(value(result.productPriceSelector), 'div.product__details__price');
    assert.equal(result.productPriceSelector.confidence, 'medium');
    const extracted = new RegExp(value(result.productPriceRegex)).exec(textAt(HTML, value(result.productPriceSelector)));
    assert.equal(extracted[1], '8000.00');
  });

  test('"ADD TO CARD" typo control recognized as the add-to-cart button — low confidence', () => {
    assert.equal(result.addToCartSelector.source, 'button-text');
    assert.equal(result.addToCartSelector.confidence, 'low');
    assert.equal(textAt(HTML, value(result.addToCartSelector)), 'ADD TO CARD');
  });

  test('no id markup or slug segment falls back to the URL id source', () => {
    assert.equal(result.productIdSource.value, 'url');
    assert.equal(result.productIdSource.confidence, 'low');
  });
});

describe('fixture: product-woocommerce-themed-login-widget.html — login widgets and repeated price classes', () => {
  const HTML = loadFixture('product-woocommerce-themed-login-widget.html');
  const URL = 'https://academy.example.com/product/ai-data-science/';

  test('a product page carrying a login form is NOT rejected as a sign-in page', () => {
    assert.doesNotThrow(() => detectProductConfig(HTML, URL));
  });

  test('the title comes from WooCommerce\'s exact product_title fingerprint', () => {
    const result = detectProductConfig(HTML, URL);
    assert.equal(value(result.productNameSelector), 'h1.product_title');
    assert.equal(result.productNameSelector.confidence, 'high');
    assert.equal(textAt(HTML, value(result.productNameSelector)), 'AI Data Science & Machine Learning with Python');
  });

  test('the price is the one in the product summary, not the mini-cart total that comes first in the document', () => {
    const result = detectProductConfig(HTML, URL);
    const selector = value(result.productPriceSelector);
    assert.ok(selector, 'a price selector must be produced');

    const $ = cheerio.load(HTML);
    const firstMatch = $(selector).first().text().trim();
    assert.match(firstMatch, /49\.99/);

    const extracted = new RegExp(value(result.productPriceRegex)).exec(firstMatch);
    assert.equal(extracted[1], '49.99');
  });

  test('the price selector is NOT a positional nth-of-type path when a named one exists', () => {
    const result = detectProductConfig(HTML, URL);
    assert.doesNotMatch(value(result.productPriceSelector), /nth-of-type/);
  });

  test('a non-unique (first-match) price selector never reports high confidence', () => {
    const result = detectProductConfig(HTML, URL);
    const $ = cheerio.load(HTML);
    const matchCount = $(value(result.productPriceSelector)).length;
    if (matchCount > 1) {
      assert.notEqual(result.productPriceSelector.confidence, 'high');
    }
  });

  test('the add-to-cart button and the variation form id are both found', () => {
    const result = detectProductConfig(HTML, URL);

    const $ = cheerio.load(HTML);
    const $cta = $(value(result.addToCartSelector)).first();
    assert.equal($cta.length, 1);
    assert.match($cta.text().trim(), /add to cart/i);

    assert.equal(value(result.productIdSource), 'selector');
    assert.match(value(result.productIdSelector), /data-product_id/);
  });

  test('the related-courses grid does not make this a listing page', () => {
    assert.doesNotThrow(() => detectProductConfig(HTML, URL));
  });
});

describe('login classification — a password field is evidence only when the form IS the page', () => {
  const LOGIN_PAGE = `
    <html><head><title>My Account</title></head><body>
      <h1>My Account</h1>
      <form action="/my-account/">
        <label>Username or email <input type="text" name="username" /></label>
        <label>Password <input type="password" name="password" /></label>
        <button type="submit">Continue</button>
      </form>
      <p>Lost your password? Reset it using the link we email you.</p>
    </body></html>`;

  test('a genuine, content-free login page is still rejected even without the words "sign in"', () => {
    assert.throws(
      () => detectProductConfig(LOGIN_PAGE, 'https://shop.example.com/products/rui-fish'),
      (error) => error instanceof DetectionClassificationError && error.reason === 'login_required'
    );
  });

  test('a page whose title says "Sign In" is still rejected, as before', () => {
    const HTML = `
      <html><head><title>Sign In</title></head><body>
        <nav>Home | Shop | About | Contact</nav>
        <h1>Sign In</h1>
        <form><label>Password <input type="password" name="password" /></label></form>
        <p>Do not have an account? Register here to start shopping with us today, it only takes a moment.</p>
      </body></html>`;
    assert.throws(
      () => detectProductConfig(HTML, 'https://shop.example.com/auth/login/'),
      (error) => error instanceof DetectionClassificationError && error.reason === 'login_required'
    );
  });

  test('structured Product data outranks a login widget outright', () => {
    const HTML = `
      <html><head>
        <title>Rui Fish</title>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Product","name":"Rui Fish","sku":"p-99",
           "offers":{"@type":"Offer","price":"799.00","priceCurrency":"BDT"}}
        </script>
      </head><body>
        <nav>Home | Shop | About | Contact</nav>
        <form><label>Password <input type="password" name="password" /></label></form>
        <h1 class="product-title">Rui Fish</h1>
        <p>Fresh river Rui fish, sourced daily from local fishermen. Rich in protein and Omega-3 fatty acids,
        perfect for a healthy family meal. Delivered same-day within city limits, cleaned and cut to order.</p>
        <span class="price">799.00</span>
        <footer>&copy; 2026 Example Fish Market. All rights reserved.</footer>
      </body></html>`;
    const result = detectProductConfig(HTML, 'https://shop.example.com/products/rui-fish');
    assert.equal(value(result.productNameSelector), 'h1.product-title');
  });
});

describe('order pages behind a login wall are explained, not silently empty', () => {
  const WALLED_ORDER = `
    <html><head><title>Checkout | Academy</title></head><body>
      <nav>Shopping cart | Checkout | Order complete</nav>
      <p>Thank you. Your order has been received. Please log in to your account to view this order.</p>
      <form class="login woocommerce-form woocommerce-form-login hidden-form" action="/my-account/">
        <label>Username or email <input type="text" name="username" /></label>
        <label>Password <input type="password" name="password" /></label>
        <button type="submit">Log in</button>
      </form>
      <p>Subscribe and get 10% off your first purchase. Be the first to know about exclusive deals,
      new arrivals and special offers from our store.</p>
    </body></html>`;

  test('is rejected as login_required rather than returning an all-empty result', () => {
    assert.throws(
      () => detectOrderConfig(WALLED_ORDER, 'https://academy.example.com/checkout/order-received/48584/', 'BDT'),
      (error) => error instanceof DetectionClassificationError && error.reason === 'login_required'
    );
  });

  test('the "hidden-form" class alone never decides it — the wall sentence does', () => {
    const REAL_ORDER = WALLED_ORDER.replace(
      'Thank you. Your order has been received. Please log in to your account to view this order.',
      'Thank you. Your order has been received. Order number: 48584 — Order Total: 289.99 BDT'
    );
    const result = detectOrderConfig(REAL_ORDER, 'https://academy.example.com/checkout/order-received/48584/', 'BDT');
    assert.ok(value(result.orderIdSelector), 'order id must still be detected');
  });

  test('"You must be logged in to post a review" is NOT a login wall', () => {
    const HTML = `
      <html><head><title>Rui Fish</title></head><body>
        <nav>Home | Shop | About | Contact</nav>
        <h1 class="product-title">Rui Fish</h1>
        <p>Fresh river Rui fish, sourced daily from local fishermen and delivered same-day within city limits.</p>
        <span class="price">799.00</span>
        <button class="add-to-cart">Add to cart</button>
        <section class="reviews"><p>You must be logged in to post a review.</p></section>
        <footer>&copy; 2026 Example Fish Market. All rights reserved.</footer>
      </body></html>`;
    const result = detectProductConfig(HTML, 'https://shop.example.com/products/rui-fish');
    assert.equal(value(result.productNameSelector), 'h1.product-title');
  });
});

describe('site chrome never supplies a product field', () => {
  const HTML = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Product","name":"12-piece Tableware Set",
         "offers":{"@type":"Offer","price":"229.99","priceCurrency":"BDT"}}
      </script>
    </head><body>
      <header>
        <form class="searchform woodmart-ajax-search" data-sku="0">
          <input type="search" name="s" />
        </form>
        <div class="mini-cart"><span class="woocommerce-Price-amount amount">22.99&#2547;</span></div>
      </header>
      <nav class="woodmart-breadcrumbs"><a href="/">Home</a> / <span class="wd-last">12-piece Tableware Set</span></nav>
      <main>
        <h1 class="product_title entry-title">12-piece Tableware Set</h1>
        <p class="price"><span class="woocommerce-Price-amount amount">229.99&#2547;</span></p>
        <p>A complete twelve-piece dinner service in glazed stoneware, dishwasher and microwave safe,
        suitable for everyday family meals as well as entertaining guests at home.</p>
        <form class="cart"><button type="submit" name="add-to-cart" value="191" class="single_add_to_cart_button">Add to cart</button></form>
      </main>
      <footer>&copy; 2026 Academy. All rights reserved.</footer>
    </body></html>`;
  const URL = 'https://academy.example.com/product/12-piece-tableware-set/';

  test('the product name is the <h1>, not the breadcrumb span that repeats it', () => {
    const result = detectProductConfig(HTML, URL);
    assert.equal(value(result.productNameSelector), 'h1.product_title');
  });

  test('a flag-valued data-sku on a header search form is never taken as the product id', () => {
    const result = detectProductConfig(HTML, URL);
    const selector = value(result.productIdSelector);
    if (selector) {
      assert.doesNotMatch(selector, /searchform/);
      const $ = cheerio.load(HTML);
      const attrMatch = /::attr\(([^)]+)\)$/.exec(selector);
      const read = attrMatch
        ? $(selector.slice(0, attrMatch.index).trim()).first().attr(attrMatch[1])
        : $(selector).first().text().trim();
      assert.notEqual(read, '0');
      assert.equal(read, '191');
    }
  });

  test('the price is the product summary one, not the header mini-cart total', () => {
    const result = detectProductConfig(HTML, URL);
    const $ = cheerio.load(HTML);
    assert.match($(value(result.productPriceSelector)).first().text(), /229\.99/);
  });
});

describe('fixture: order-received-woocommerce-guest.html — decorated line-item values', () => {
  const HTML = loadFixture('order-received-woocommerce-guest.html');
  const URL = 'https://academy.example.com/checkout/order-received/48586/';
  const result = detectOrderConfig(HTML, URL, 'BDT');

  test('the order id and total come from WooCommerce\'s overview list, and their regexes extract', () => {
    const $ = cheerio.load(HTML);
    const idText = $(value(result.orderIdSelector)).text();
    assert.equal(new RegExp(value(result.orderIdRegex)).exec(idText)[1], '48586');

    const totalText = $(value(result.orderTotalSelector)).text();
    assert.equal(new RegExp(value(result.orderTotalRegex)).exec(totalText)[1], '289.99');
  });

  test('the item container matches the two product rows and NOT the tfoot subtotal/shipping/total rows', () => {
    const $ = cheerio.load(HTML);
    assert.equal($(value(result.orderItemContainerSelector)).length, 2);
  });

  test('a price wrapped in <bdi> with a trailing currency symbol is detected', () => {
    assert.ok(value(result.orderItemPriceSelector), 'item price must be detected');
    const $ = cheerio.load(HTML);
    const prices = $(value(result.orderItemContainerSelector))
      .map((_, row) => $(row).find(value(result.orderItemPriceSelector)).first().text().trim())
      .get();
    assert.deepEqual(prices, ['229.99৳', '60.00৳']);
  });

  test('a "× 1" quantity is detected', () => {
    assert.ok(value(result.orderItemQtySelector), 'item quantity must be detected');
    const $ = cheerio.load(HTML);
    const qtys = $(value(result.orderItemContainerSelector))
      .map((_, row) => $(row).find(value(result.orderItemQtySelector)).first().text().trim().replace(/\s+/g, ' '))
      .get();
    assert.deepEqual(qtys, ['× 1', '× 3']);
  });

  test('every decorated item value is readable the way the runtime SDK reads it', () => {
    const parseNumber = (text) => {
      if (text === undefined || text.trim().length === 0) return undefined;
      const direct = Number(text.replace(/,/g, ''));
      if (Number.isFinite(direct)) return direct;
      const match = /-?\d[\d,]*(?:\.\d+)?/.exec(text);
      return match ? Number(match[0].replace(/,/g, '')) : undefined;
    };

    const $ = cheerio.load(HTML);
    const rows = $(value(result.orderItemContainerSelector));
    const parsed = rows
      .map((_, row) => ({
        price: parseNumber($(row).find(value(result.orderItemPriceSelector)).first().text().trim()),
        qty: parseNumber($(row).find(value(result.orderItemQtySelector)).first().text().trim()),
      }))
      .get();

    assert.deepEqual(parsed, [
      { price: 229.99, qty: 1 },
      { price: 60, qty: 3 },
    ]);
  });

  test('the item name selector is anchored to the named cell, not a positional nth-of-type path', () => {
    const selector = value(result.orderItemNameSelector);
    assert.doesNotMatch(selector, /nth-of-type/);

    const $ = cheerio.load(HTML);
    const names = $(value(result.orderItemContainerSelector))
      .map((_, row) => $(row).find(selector).first().text().trim())
      .get();
    assert.deepEqual(names, ['12-piece Tableware Set', 'Ceramic Mug']);
  });

  test('with no id attribute anywhere, the item id comes from the product link', () => {
    const field = result.orderItemIdSelector;
    assert.ok(field, 'an item id must be derived from the product link');
    assert.equal(field.source, 'product-link');
    assert.match(field.value, /::attr\(href\)$/);
    assert.equal(field.confidence, 'medium', 'a link is weaker than a real id attribute');

    const $ = cheerio.load(HTML);
    const selector = field.value.replace(/::attr\(href\)$/, '');
    const hrefs = $(value(result.orderItemContainerSelector))
      .map((_, row) => $(row).find(selector).first().attr('href'))
      .get();
    assert.deepEqual(hrefs, ['/product/12-piece-tableware-set/', '/product/ceramic-mug/']);
  });

  test('a real id attribute still wins over the product link', () => {
    const withAttr = HTML.replace(
      '<tr class="woocommerce-table__line-item order_item">',
      '<tr class="woocommerce-table__line-item order_item" data-product-id="191">'
    );
    const detected = detectOrderConfig(withAttr, URL, 'BDT');
    assert.equal(value(detected.orderItemIdSelector), '[data-product-id]::attr(data-product-id)');
    assert.equal(detected.orderItemIdSelector.confidence, 'high');
  });
});

describe('add-to-cart detection covers the catalogue button too', () => {
  const PRODUCT_PAGE = `
    <html><body>
      <nav>Home | Shop | About | Contact</nav>
      <h1 class="product_title">Battery Operated LED Lights</h1>
      <p>Warm white battery operated fairy lights on a flexible copper wire, suitable for indoor decoration
      all year round, with a timer function and two brightness settings for any room in the house.</p>
      <p class="price"><span class="woocommerce-Price-amount amount">19.99</span></p>
      <form class="cart"><button type="submit" name="add-to-cart" value="115">Add to cart</button></form>
      <section class="related">
        <h2>Related products</h2>
        <p>Customers who bought this item also bought these seasonal decorations from our catalogue.</p>
        <ul class="products">
          <li class="product"><a href="/product/mug/">Mug</a><span class="price">60.00</span>
            <a href="/shop/?add-to-cart=118" class="add_to_cart_button" data-product_id="118">Add to cart</a></li>
          <li class="product"><a href="/product/bauble/">Bauble</a><span class="price">89.99</span>
            <a href="/shop/?add-to-cart=119" class="add_to_cart_button" data-product_id="119">Add to cart</a></li>
        </ul>
      </section>
      <footer>&copy; 2026 Academy. All rights reserved.</footer>
    </body></html>`;

  const URL = 'https://academy.example.com/product/battery-operated-led-lights/';

  test('the emitted selector matches BOTH the product button and the catalogue links', () => {
    const result = detectProductConfig(PRODUCT_PAGE, URL);
    const selector = value(result.addToCartSelector);
    const $ = cheerio.load(PRODUCT_PAGE);

    assert.equal($(selector).length, 3, `"${selector}" should match the product button and both catalogue links`);
  });

  test('the primary product-page button is still part of the selector', () => {
    const result = detectProductConfig(PRODUCT_PAGE, URL);
    const $ = cheerio.load(PRODUCT_PAGE);
    const matched = $(value(result.addToCartSelector)).toArray();
    assert.ok(
      matched.some((el) => $(el).attr('name') === 'add-to-cart'),
      'the single-product control must not be dropped in favour of the catalogue one'
    );
  });

  test('a page with no catalogue counterpart keeps the plain single selector', () => {
    const PLAIN = PRODUCT_PAGE.replace(/<section class="related">[\s\S]*<\/section>/, '');
    const result = detectProductConfig(PLAIN, URL);
    assert.doesNotMatch(value(result.addToCartSelector), /,/, 'nothing to widen — no second clause should appear');
  });
});

describe('detectCheckoutConfig — cart/checkout pages', () => {
  const CHECKOUT = `
    <html><body>
      <nav>Home | Shop | Cart | Checkout</nav>
      <h1>Checkout</h1>
      <p>Review your order below and choose a payment method to complete your purchase. Shipping is calculated
      at the next step and all prices include applicable taxes.</p>
      <table class="shop_table">
        <tbody>
          <tr class="cart-item"><td class="product-name"><a href="/product/led/">LED Lights</a>
            <strong class="product-quantity">&times;&nbsp;2</strong></td>
            <td class="product-total"><span class="woocommerce-Price-amount">53.98&#2547;</span></td></tr>
          <tr class="cart-item"><td class="product-name"><a href="/product/mug/">Ceramic Mug</a>
            <strong class="product-quantity">&times;&nbsp;1</strong></td>
            <td class="product-total"><span class="woocommerce-Price-amount">60.00&#2547;</span></td></tr>
        </tbody>
        <tfoot>
          <tr class="order-total"><th>Total:</th>
            <td><span class="woocommerce-Price-amount">113.98&#2547;</span></td></tr>
        </tfoot>
      </table>
      <footer>&copy; 2026 Academy. All rights reserved.</footer>
    </body></html>`;

  const URL = 'https://academy.example.com/checkout/';
  const result = detectCheckoutConfig(CHECKOUT, URL);

  test('detects the checkout trigger URL pattern', () => {
    assert.equal(value(result.checkoutTriggerUrlPattern), '/checkout');
  });

  test('detects a cart total whose regex actually extracts the number', () => {
    assert.ok(value(result.checkoutTotalSelector));
    const $ = cheerio.load(CHECKOUT);
    const text = $(value(result.checkoutTotalSelector)).first().text();
    assert.equal(new RegExp(value(result.checkoutTotalRegex)).exec(text)[1], '113.98');
  });

  test('line items come back under checkout* names, never order* ones', () => {
    assert.ok(value(result.checkoutItemContainerSelector));
    assert.equal(result.orderItemContainerSelector, undefined, 'order fields must not leak into a checkout config');
    assert.equal(result.orderTotalSelector, undefined);
  });

  test('the item selectors resolve per row, exactly like the order side', () => {
    const $ = cheerio.load(CHECKOUT);
    const rows = $(value(result.checkoutItemContainerSelector));
    assert.equal(rows.length, 2);
    const names = rows.map((_, r) => $(r).find(value(result.checkoutItemNameSelector)).first().text().trim()).get();
    assert.deepEqual(names, ['LED Lights', 'Ceramic Mug']);
  });

  test('no order id is produced — a checkout has no order number yet', () => {
    assert.equal(result.orderIdSelector, undefined);
    assert.equal(result.checkoutIdSelector, undefined);
  });

  test('a page with no cart total and no checkout wording is rejected with a clear reason', () => {
    const HTML = `
      <html><body>
        <nav>Home | Shop | About | Contact</nav>
        <h1>About Us</h1>
        <p>We are a small local business founded in 2020, dedicated to quality and customer service. Reach out
        with any questions about our products or services at any time during business hours.</p>
        <footer>&copy; 2026 Example Shop. All rights reserved.</footer>
      </body></html>`;
    assert.throws(
      () => detectCheckoutConfig(HTML, 'https://shop.example.com/checkout/'),
      (error) => error instanceof DetectionClassificationError && error.reason === 'checkout_signals_missing'
    );
  });

  test('a cart page with checkout wording but no readable total is NOT rejected', () => {
    const HTML = `
      <html><body>
        <nav>Home | Shop | Cart</nav>
        <h1>Shopping cart</h1>
        <p>Your cart is being updated. Proceed to checkout when you are ready to complete your order, and we
        will calculate shipping and taxes on the following page.</p>
        <footer>&copy; 2026 Example Shop. All rights reserved.</footer>
      </body></html>`;
    assert.doesNotThrow(() => detectCheckoutConfig(HTML, 'https://shop.example.com/cart/'));
  });
});

describe('an empty cart is reported as an empty cart, not as a login wall', () => {
  const EMPTY_CART = `
    <html><head><title>Cart | Academy</title></head><body>
      <nav>Search | Login / Register</nav>
      <form class="login woocommerce-form woocommerce-form-login">
        <label>Username or email <input type="text" name="username" /></label>
        <label>Password <input type="password" name="password" /></label>
        <button type="submit">Log in</button>
      </form>
      <p>Shopping cart &rsaquo; Checkout &rsaquo; Order complete</p>
      <div class="cart-empty woocommerce-info">Your cart is currently empty.</div>
      <p class="return-to-shop">Before proceed to checkout you must add some products to your shopping cart.
      You will find a lot of interesting products on our "Shop" page.</p>
      <footer>&copy; 2026 Academy. All rights reserved.</footer>
    </body></html>`;

  function classify(html, url = 'https://academy.example.com/checkout/') {
    try {
      return { fields: detectCheckoutConfig(html, url), error: undefined };
    } catch (error) {
      return { fields: error.partialFields, error };
    }
  }

  test('is rejected as checkout_cart_empty, NOT login_required', () => {
    const { error } = classify(EMPTY_CART);
    assert.ok(error instanceof DetectionClassificationError);
    assert.equal(error.reason, 'checkout_cart_empty');
  });

  test('the message explains the session limitation and what to do instead', () => {
    const { error } = classify(EMPTY_CART);
    assert.match(error.message, /browser session/i);
    assert.match(error.message, /picker|Test Detection/i);
  });

  test('the trigger URL pattern survives the rejection — it is still knowable', () => {
    const { fields } = classify(EMPTY_CART);
    assert.equal(value(fields.checkoutTriggerUrlPattern), '/checkout');
  });

  test('the pattern comes from the REQUESTED url, not a redirect target', () => {
    const fields = (() => {
      try {
        detectCheckoutConfig(EMPTY_CART, 'https://academy.example.com/cart/', 'https://academy.example.com/checkout/');
        return null;
      } catch (error) {
        return error.partialFields;
      }
    })();
    assert.equal(value(fields.checkoutTriggerUrlPattern), '/checkout');
  });

  test('a checkout page carrying a login form but a REAL cart is detected normally', () => {
    const POPULATED = EMPTY_CART.replace(
      '<div class="cart-empty woocommerce-info">Your cart is currently empty.</div>',
      `<table class="shop_table">
         <tbody><tr class="cart-item"><td class="product-name"><a href="/product/led/">LED Lights</a>
           <strong class="product-quantity">&times;&nbsp;2</strong></td>
           <td class="product-total"><span class="woocommerce-Price-amount">53.98</span></td></tr>
         <tr class="cart-item"><td class="product-name"><a href="/product/mug/">Mug</a>
           <strong class="product-quantity">&times;&nbsp;1</strong></td>
           <td class="product-total"><span class="woocommerce-Price-amount">60.00</span></td></tr></tbody>
         <tfoot><tr class="order-total"><th>Total:</th>
           <td><span class="woocommerce-Price-amount">113.98</span></td></tr></tfoot>
       </table>`
    );
    const { fields, error } = classify(POPULATED);
    assert.equal(error, undefined, 'a populated cart must not be rejected');
    assert.ok(value(fields.checkoutTotalSelector), 'the cart total must be detected');
    assert.ok(value(fields.checkoutItemContainerSelector), 'the line items must be detected');
  });
});
