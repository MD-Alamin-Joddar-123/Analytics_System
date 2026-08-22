# Tracking SDK — Integration Guide

This is the customer-facing guide for adding analytics tracking to any
website. If you're looking for how the SDK is built internally, see
`docs/SDK_ARCHITECTURE.md` instead — this document only covers using it.

## The entire required integration

Add this **one script tag** anywhere in your page — `<head>` is
recommended:

```html
<head>
  <script
    src="https://analytics.yourdomain.com/tracking.js"
    data-website-id="abc123">
  </script>
</head>
```

Replace `abc123` with your website's tracking id (find it on your
Analytics dashboard under Websites). That's it — **one script = SDK
loaded.**

The script also works with `defer`:

```html
<script
  src="https://analytics.yourdomain.com/tracking.js"
  data-website-id="abc123"
  defer>
</script>
```

You do **not** need to:

- install any npm package,
- configure a bundler, React, Next.js, Vue, Angular, Svelte, Django,
  Flask, Laravel, or any other framework,
- specify an API URL — the script figures that out from its own address,
- write any additional code at all, for basic page-view analytics.

## What happens automatically

The moment the script loads, it starts tracking, with no further code
required:

- **Page views** — on load, and on every route change if your site is a
  single-page app (React Router, Next.js client navigation, Vue Router,
  etc. — detected via the History API, see below).
- **Visitor and session identification** — an anonymous, opaque id per
  visitor (persisted across visits) and per browsing session. Nothing
  identifying (no name, email, IP, or fingerprint) is ever collected.
- **Standard page context** — URL, path, referrer, page title, browser
  language, screen size, and timezone.

## Platform support

The same script works, unmodified, on:

Plain HTML/JavaScript sites · React · Next.js · Vue · Angular · Svelte ·
Django templates · Flask · Laravel · PHP · WordPress · Shopify ·
WooCommerce · any other browser-rendered website.

There is nothing platform-specific to configure. If your framework
server-renders HTML that eventually reaches a real browser with this
`<script>` tag in it, tracking works.

## Tracking ecommerce activity

Automatic tracking covers page views. For ecommerce events — a product
being viewed, added to a cart, checked out, or purchased — your site
needs to tell the SDK when those things happen, because **a script has no
way to know your product/cart/order data unless your page tells it.**
There are two ways to do that: an explicit JavaScript call, or a
declarative HTML attribute. Use whichever fits the moment.

### Explicit API (recommended for anything server-driven, like checkout/purchase)

```js
// When a product page loads
window.Analytics.productView({
  productId: 'sku-123',
  name: 'Wireless Mouse',
  price: 29.99,
  currency: 'USD',
});

// When a shopper adds an item to their cart
window.Analytics.addToCart({
  productId: 'sku-123',
  name: 'Wireless Mouse',
  price: 29.99,
  quantity: 1,
  currency: 'USD',
  cartId: 'cart-abc',   // optional, links related cart events together
});

// When an item is removed
window.Analytics.removeFromCart({
  productId: 'sku-123',
  quantity: 1,
  cartId: 'cart-abc',
});

// When checkout begins
window.Analytics.checkout({
  checkoutId: 'chk-456',   // optional
  cartId: 'cart-abc',      // optional
  cartValue: 29.99,
  currency: 'USD',
  items: [{ productId: 'sku-123', name: 'Wireless Mouse', price: 29.99, quantity: 1 }],
});

// When an order is completed
window.Analytics.purchase({
  orderId: 'order-789',
  revenue: 29.99,
  currency: 'USD',
  items: [{ productId: 'sku-123', name: 'Wireless Mouse', price: 29.99, quantity: 1 }],
  checkoutId: 'chk-456',   // optional, links back to the checkout
});
```

Call these from wherever your own "add to cart" handler, checkout page,
or order-confirmation page already runs — the SDK doesn't (and can't)
guess when those moments happen; you tell it.

> **Note on `checkout()`'s `itemCount`**: you may pass an `itemCount`
> field for your own bookkeeping/readability, but it is not transmitted —
> the backend doesn't currently store a separate item-count field on
> checkout events (it's derivable from `items.length`). This is
> documented here rather than silently ignored so it's never a surprise.

### Declarative HTML attributes (good for simple, static "Add to Cart" buttons)

```html
<button
  data-analytics-event="add_to_cart"
  data-product-id="sku-123"
  data-product-name="Wireless Mouse"
  data-product-price="29.99"
  data-quantity="1"
  data-currency="USD">
  Add to Cart
</button>
```

The SDK detects the click and sends the event automatically — no
JavaScript required on your part. Supported values for
`data-analytics-event`:

| Value | Required attributes | Optional attributes |
|---|---|---|
| `product_view` | `data-product-id` | `data-product-name`, `data-product-price`, `data-currency` |
| `add_to_cart` | `data-product-id`, `data-product-price` | `data-product-name`, `data-quantity` (default 1), `data-currency`, `data-cart-id` |
| `remove_from_cart` | `data-product-id` | `data-quantity` (default 1), `data-product-price`, `data-product-name`, `data-currency`, `data-cart-id` |
| `checkout` | `data-cart-value`, `data-currency`, `data-items` (JSON array, see below) | `data-checkout-id`, `data-cart-id` |
| `purchase` | `data-order-id`, `data-revenue`, `data-currency`, `data-items` (JSON array) | `data-checkout-id` |

`data-items` (checkout/purchase only) is a JSON-encoded array of line
items: `data-items='[{"productId":"sku-123","price":29.99,"quantity":1}]'`.
Because checkout/purchase need a full item list, the **explicit JS API is
usually the better fit for those two** — the HTML attribute form is
offered for completeness, but a real checkout/order confirmation page
almost always has that data available in a `<script>` block already,
where the JS API is simpler to use correctly.

Only the attributes listed above are ever read — nothing about the
button's own text, classes, or any other attribute is collected.

### Generic custom events

```js
window.Analytics.track('purchase', { orderId: 'order-789', revenue: 29.99, currency: 'USD', items: [...] });
```

`track(eventName, data)` accepts any event name your backend supports.
Today that's `page_view`, `product_view`, `add_to_cart`,
`remove_from_cart`, `checkout`, and `purchase` — the same six event types
every helper method above sends. An unsupported event name is not
silently accepted; it's rejected the same way the API has always rejected
one.

## Single-page apps (React, Next.js, Vue, Angular, Svelte, ...)

No extra configuration needed. The SDK detects `history.pushState`,
`history.replaceState`, and `popstate` navigation and sends a `page_view`
for each real route change automatically — your router doesn't need to
call anything. If you'd rather handle page views yourself, disable the
automatic ones and call `Analytics.pageView()` manually:

```html
<script src="https://analytics.yourdomain.com/tracking.js" data-website-id="abc123" data-auto-pageview="false"></script>
```

## Other optional configuration

All optional, all via attributes on the same `<script>` tag:

| Attribute | Default | Purpose |
|---|---|---|
| `data-debug="true"` | off | Logs every tracking decision to the browser console — useful while integrating |
| `data-auto-pageview="false"` | on | Disable automatic page views (SPA route changes still detected unless `data-auto-spa` is also disabled) |
| `data-auto-spa="false"` | on | Disable SPA route-change detection entirely |
| `data-auto-detect-jsonld="true"` | off | Best-effort: auto-fires `product_view` from a `schema.org Product` `<script type="application/ld+json">` block already on the page, if one is present and unambiguous |

## What you get in your dashboard

Once installed, your Analytics dashboard's Overview, Ecommerce, and
Products pages populate from real traffic: page views, unique
visitors/sessions, product views, add/remove-to-cart, checkout
started/completed, orders, gross/net revenue, conversion rates, and a
sortable product performance table — all computed by the existing
backend from the events this script sends, with no separate setup.

**On profit**: revenue is computed from your purchase/order data, exactly
as reported. **Profit is not currently calculated anywhere in this
platform** — that would require your actual product cost, which a
tracking script embedded in a browser has no legitimate way to know
unless you explicitly provide it through a real cost-data integration.
No number in your dashboard is ever a guess.

## Privacy

This SDK never collects passwords, card numbers, CVV codes, authentication
tokens, cookie contents, arbitrary form field values, or your visitors' IP
addresses. Visitor and session identifiers are randomly generated, opaque
strings — never derived from anything identifying.
