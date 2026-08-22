# Production Integration Guide

This is the single top-to-bottom walkthrough for taking the Universal
Ecommerce Analytics platform from "an account doesn't exist yet" to "a
live ecommerce website is sending real analytics to a working dashboard."
Every other `docs/*.md` file covers one phase/layer in depth; this one
ties them together in the order a real user actually experiences them.

## Architecture at a glance

```
 Customer Website (any platform — HTML/React/Next.js/Vue/Django/PHP/...)
         │
         │  ONE <script> tag
         ▼
 tracking.js  (frontend/sdk — Phase 11)
         │  POST /api/collect  (public, no auth — websiteId is public)
         ▼
 ┌─────────────────────────── backend (this repo) ───────────────────────────┐
 │  Validation (Phase 4) → Event persisted → Redis/BullMQ queue (Phase 7)     │
 │                                              │                             │
 │                                              ▼                             │
 │                                   Worker process (separate OS process)     │
 │                                              │                             │
 │              ┌───────────────────────────────┼───────────────────────┐    │
 │              ▼                                ▼                       ▼    │
 │     Visitor/Session resolution      Commerce normalization    Analytics    │
 │            (Phase 5)                 Product/Cart/Checkout/    aggregation │
 │                                       Order/OrderItem (Phase 6) (Phase 8)  │
 │                                              │                       │     │
 │                                              └──────────┬────────────┘     │
 │                                                          ▼                 │
 │                                          AnalyticsBucket / ProductAnalytics │
 │                                                          │                 │
 │                                                          ▼                 │
 │                                    Reporting API — GET /api/reports/*      │
 │                                              (Phase 9, authenticated)      │
 └──────────────────────────────────────────────┬────────────────────────────┘
                                                  │
                                                  ▼
                                    Dashboard (frontend/ — Phase 10)
                                    /login, /dashboard/overview,
                                    /dashboard/ecommerce, /dashboard/products
```

MongoDB, Redis, and the JWT signing secret exist **only** inside the
shaded backend box above — nothing outside it (the customer's website,
the tracking script, the dashboard's browser bundle) ever has access to
them, by construction, not just by policy. See §10 for the full audit.

---

## 1. Create an account

```bash
curl -X POST https://your-backend-domain.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe","email":"jane@example.com","password":"a-strong-password"}'
```

Or use the dashboard's login screen — registration returns a JWT
immediately (`{ data: { user, token } }`), the same token the dashboard
stores and uses for every subsequent authenticated request.

## 2. Create a website

```bash
curl -X POST https://your-backend-domain.com/api/websites \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Store","domain":"mystore.example.com","timezone":"America/New_York","currency":"USD"}'
```

`ownerId` is never something you supply — it's always the authenticated
user from the JWT (Phase 3 §9's ownership boundary, unchanged and
re-verified in this phase's security audit, §10 below).

## 3. Get your websiteId

The response's `data.website.websiteId` is a public, 16-character
identifier — **not** your MongoDB `_id**, and not a secret. It's designed
to be embedded in a public `<script>` tag on your website, the same way a
Google Analytics measurement id or a Stripe publishable key is public:

```json
{ "success": true, "data": { "website": { "websiteId": "a1b2c3d4e5f60718", "name": "My Store", ... } } }
```

You can also list your websites at any time via `GET /api/websites`, or
find this id in the dashboard.

## 4. Add one tracking script

```html
<head>
  <script
    src="https://your-backend-domain.com/tracking.js"
    data-website-id="a1b2c3d4e5f60718">
  </script>
</head>
```

That's the entire required integration. No npm install, no backend code,
no separate configuration file, no API endpoint to specify — the script
discovers the collector endpoint from its own `src` (see
`docs/SDK_ARCHITECTURE.md` §4). Full reference:
`docs/SDK_INTEGRATION.md`.

## 5. Automatic page tracking

Once the script loads, it automatically tracks, with zero further code:

- `page_view` on load, and on every SPA route change (`pushState`/
  `replaceState`/`popstate` — React Router, Next.js, Vue Router, etc.)
- An anonymous, opaque **visitor id** (persisted in `localStorage`) and
  **session id** (persisted in `sessionStorage`, naturally scoped to one
  browser tab)
- Page **URL**, **path**, **title**, **referrer**
- Browser **language**, **screen width/height**, **timezone**

Loading the script twice (two `<script>` tags, a tag-manager double-
inject) is safe — the SDK guards against duplicate initialization and
never attaches a second set of listeners (`docs/SDK_ARCHITECTURE.md`
§11).

## 6. Ecommerce event integration

Automatic tracking cannot know your product/cart data — a script has no
way to see what "add to cart" means on your specific site unless your
page tells it. Add small calls at the moments your own ecommerce logic
already has this data:

```js
window.Analytics.productView({ productId: 'sku-123', name: 'Wireless Mouse', price: 29.99, currency: 'USD' });
window.Analytics.addToCart({ productId: 'sku-123', price: 29.99, quantity: 1, currency: 'USD', cartId: 'cart-abc' });
window.Analytics.removeFromCart({ productId: 'sku-123', quantity: 1, cartId: 'cart-abc' });
window.Analytics.checkout({ cartValue: 29.99, currency: 'USD', items: [{ productId: 'sku-123', price: 29.99, quantity: 1 }] });
```

For simple static "Add to Cart" buttons, a declarative attribute works
without any JavaScript:

```html
<button data-analytics-event="add_to_cart" data-product-id="sku-123" data-product-price="29.99" data-quantity="1">
  Add to Cart
</button>
```

Full field reference (required vs. optional per event): `docs/SDK_INTEGRATION.md`.

## 7. Purchase tracking

On your order-confirmation page/step:

```js
window.Analytics.purchase({
  orderId: 'order-789',
  revenue: 29.99,
  currency: 'USD',
  items: [{ productId: 'sku-123', name: 'Wireless Mouse', price: 29.99, quantity: 1 }],
  checkoutId: 'chk-456', // optional — links back to a checkout() call for funnel completion
});
```

This is the one call that actually creates revenue in your dashboard —
see §11 for exactly how that number gets there and why it can be trusted.

## 8. Dashboard usage

Log in at your dashboard's `/login`, select a website (auto-selected if
you only have one), and pick a date range. Four sections:

- **Overview** (`/dashboard/overview`) — KPI cards (page views, unique
  visitors/sessions, product views, add-to-cart, checkout started/
  completed, orders, gross/net revenue, conversion rate) plus time-series
  charts with an Hour/Day granularity toggle.
- **Ecommerce** (`/dashboard/ecommerce`) — revenue breakdown (gross,
  refunded, net, order count, average order value), a conversion funnel,
  and a cart/checkout funnel.
- **Products** (`/dashboard/products`) — a sortable, paginated product
  performance table; click through to `/dashboard/products/:productId`
  for one product's detail view.

A manual **Refresh** button re-fetches whatever's currently on screen.
Every number shown is read directly from the backend's Reporting API
(Phase 9) — the dashboard performs zero independent analytics math (see
§11).

## 9. Production environment variables

All backend configuration lives in `backend/.env` (never committed — see
`backend/.env.example` for the full, commented template):

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` in production — gates stack-trace exposure and other dev-only behavior |
| `PORT` | HTTP port |
| `MONGODB_URI` | MongoDB connection string — credentialed, TLS, in production |
| `CORS_ORIGINS` | Allowed origins for the AUTHENTICATED API (your dashboard's own origin) — does not restrict `/api/collect` or `/tracking.js`, which intentionally serve any origin |
| `JWT_SECRET` | Long, random dashboard-JWT signing secret |
| `JWT_EXPIRES_IN` | Dashboard JWT lifetime |
| `SESSION_TIMEOUT_MINUTES` | Visitor inactivity window before a new Session starts |
| `REDIS_URL` | Redis connection string (queue) |
| `WORKER_CONCURRENCY` / `QUEUE_ATTEMPTS` / `QUEUE_BACKOFF` | Worker/queue tuning |

Two more, one per sub-project, each with exactly one variable:

- `frontend/.env` — `VITE_API_BASE_URL` (the dashboard's only backend
  configuration; baked in at build time).
- `frontend/sdk` — none. `tracking.js` needs no environment configuration
  at all; it derives the collector URL from its own `<script src>` at
  runtime (see §4 above and `docs/SDK_ARCHITECTURE.md` §4).

Never commit real values for any of these — only the `.env.example`
templates belong in source control.

## 10. Security considerations

Audited this phase (§8 of the Phase 12 spec); see the Phase 12 final
report for the full item-by-item pass:

- **JWT**: signed with `JWT_SECRET`, verified on every authenticated
  request (`authenticate` middleware); expired/invalid tokens rejected
  with a specific error code the dashboard maps to a forced re-login.
- **Ownership/tenant isolation**: every website-scoped query — commerce
  data, analytics buckets, reporting — filters by `websiteId` (or the
  owner-scoped internal `_id` for website management) as a leading query
  field, never as an application-level afterthought. Verified by
  dedicated cross-tenant tests at every layer (Phase 3's
  `website.ownership.test.js`, Phase 8/9's isolation tests, this phase's
  end-to-end isolation test).
- **Input validation / injection**: every validator checks `typeof value
  === 'string'` (or the appropriate primitive type) *before* a value ever
  reaches a MongoDB query — an object payload like `{"email":{"$gt":""}}`
  is rejected as "not a string," never passed through to Mongoose.
- **Allow-lists, not pass-through**: supported event names
  (`SUPPORTED_EVENTS`), `data` payload fields (per-event validators),
  reporting sort fields (`PRODUCT_SORT_FIELDS`) are all explicit
  allow-lists — nothing about report sorting or event ingestion accepts
  an arbitrary client-supplied field name and forwards it into a query.
- **Sensitive fields**: passwords, card numbers, CVV, and auth tokens are
  never fields on any schema in this system — structurally absent, not
  filtered after the fact. `passwordHash` is `select:false` at the schema
  level, stripped again in `toJSON`, and stripped a third time in
  `toSafeUser` (defense in depth).
- **Pagination/sort limits**: product list pagination caps at 100 items
  per page (`PAGINATION_MAX_LIMIT`); sort is allow-listed (§ above).
- **CORS/Helmet/body limits**: Helmet's default headers on every route;
  the authenticated API uses a fixed origin allow-list
  (`CORS_ORIGINS`), while the public collector and `/tracking.js`
  deliberately allow any origin (that's the point of a universal,
  embeddable script — see `docs/SDK_ARCHITECTURE.md` §9); request bodies
  are capped (32 KB for `/api/collect`, 1 MB elsewhere).
- **Rate limiting**: `/api/collect` is rate-limited per IP. This is a
  documented, accepted limitation carried since Phase 4: the current
  limiter is in-memory and per-process, not distributed — correct for a
  single-instance deployment, and the one thing to swap for a
  Redis-backed limiter before running multiple API instances behind a
  load balancer.
- **No secrets ever reach the browser**: `MONGODB_URI`, `REDIS_URL`,
  `JWT_SECRET`, and all other backend configuration exist only in the
  backend process's environment. Verified structurally (grep-clean) in
  both `frontend/` and `frontend/sdk/`'s source and built bundles — see
  `frontend/sdk/tests/buildOutput.test.ts`.
- **Error responses**: stack traces are only ever included in
  `NODE_ENV=development` responses; production returns `{ success:
  false, message, error: { code } }` only.

## 11. Revenue data flow — and why it can be trusted

Revenue is **never** entered, guessed, or computed by the dashboard.
It flows, unmodified, through exactly one path:

```
purchase event's `data.revenue`/`data.items`
  → validated (Phase 4) → normalized into Order.total / OrderItem rows (Phase 6, integer minor units)
  → summed into AnalyticsBucket.grossRevenueMinor / ProductAnalyticsBucket.revenueMinor (Phase 8)
  → read back and converted to major units ONCE, at response time, never accumulated (Phase 9)
  → rendered by the dashboard via Intl.NumberFormat — a DISPLAY step, not a calculation (Phase 10)
```

`netRevenue = grossRevenue - refundedAmount`, `averageOrderValue =
grossRevenue / orderCount` — both computed from stored integers at
read time, never stored as a running float (§15 of
`docs/ANALYTICS_ARCHITECTURE.md`). A duplicate purchase submission (same
order, resubmitted) is guaranteed not to double-count revenue at three
independent layers: Phase 4's event-level idempotency, Phase 6's
order-level idempotency (`websiteId + externalOrderId`), and Phase 8's
analytics-level idempotency marker — proven together in this phase's
`tests/endToEnd.pipeline.test.js`.

## 12. Product-cost / profit architecture

**This platform does not calculate profit, anywhere, today.** This is a
deliberate boundary, not a gap that was missed:

```
Revenue = trusted order revenue         (Phase 6/8/9 — implemented)
Product Cost = trusted product cost     (NOT currently collected — see below)
Profit = Revenue − Product Cost         (NOT implemented — requires the above)
```

A browser-based tracking script has no legitimate way to know what a
product actually costs the merchant — that number lives in the
merchant's own supplier/inventory system, not in anything visible to a
customer's browser. **The public tracking SDK is never trusted as an
authoritative source of financial data.** Concretely, nothing in this
codebase accepts a client-supplied "cost" or "profit" field and persists
it as fact — there is no `productCostMinor` field on any schema today,
and no code path computes a profit number from one.

The extension point is designed, not built: a future phase could add a
server-side-only `productCostMinor` field to the `Product`/`OrderItem`
schemas (Phase 6), populated **only** through a trusted, authenticated
channel — e.g. a merchant-authenticated API call, an admin import, or a
legitimate platform integration (a real Shopify/WooCommerce cost-of-goods
API) — never through `POST /api/collect`, which remains public and
therefore untrusted for anything beyond what a browser can legitimately
observe (page activity, and self-reported order/revenue data the merchant
chooses to send from their own order-confirmation flow). Once — and only
once — that trusted cost data exists server-side, aggregating
`profit = revenue − cost` would follow the exact same pattern Phase 8
already established for revenue.

Until then: no dashboard, no report, no API response in this system ever
shows a "profit" number, fabricated or otherwise.

## 13. Supported platforms

The universal script (`docs/SDK_ARCHITECTURE.md`) is plain, dependency-
free browser JavaScript — it works, unmodified, on any platform that
ultimately renders HTML a browser executes:

Plain HTML/JavaScript · React · Next.js · Vue · Angular · Svelte · Django
templates · Flask · Laravel Blade · PHP · WordPress · Shopify ·
WooCommerce · any other browser-rendered ecommerce site.

There is no platform-specific plugin in this phase (or any phase to
date) — the same `<script>` tag is the entire integration surface for
every platform on this list. A dedicated Shopify app or WordPress plugin
would be a convenience wrapper around this same script in some future
phase, not a replacement for it.

## 14. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| No events showing up at all | Confirm the script tag's `data-website-id` matches a real, **active** website (a `paused`/`archived` website's events are rejected — `WEBSITE_PAUSED`). Add `data-debug="true"` to the script tag and check the browser console. |
| `GET /tracking.js` 404s | The SDK hasn't been built yet — run `npm run build` in `frontend/sdk/` (outputs directly to `backend/public/tracking.js`). |
| Events accepted (`202`) but dashboard shows nothing | The worker process (`npm run worker` in `backend/`) must be running separately from the API server — events are queued (Phase 7) and only become visible in reports after the worker processes them. Check `GET /health`'s `queue`/`redis` fields. |
| `GET /health` returns `degraded` | Check the `database`/`redis`/`queue` fields individually — each is reported independently so you can tell which dependency is down. |
| Dashboard shows a login redirect loop | The stored JWT is expired/invalid — the dashboard clears it automatically on any `401` and redirects to `/login`; simply log in again. |
| Revenue/order numbers look wrong | Verify you're calling `purchase()` with the SAME `orderId` you'd use if the browser retried the request — duplicate `orderId`s are deduplicated by design (§11), so an intentionally *different* order needs a distinct `orderId`. |
| A product's `checkoutQuantity` shows `N/A` | Expected — Phase 8 doesn't track a per-product checkout-line quantity; this is documented, not a bug (see §7's boundary on fabricated data — the same principle applies here). |
| CORS error calling `/api/reports/*` from a custom dashboard | That's the AUTHENTICATED API's CORS policy (`CORS_ORIGINS`) — add your dashboard's origin. This is unrelated to `/api/collect`/`/tracking.js`, which accept any origin by design. |
