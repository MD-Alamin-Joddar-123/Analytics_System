# Analytics Reporting API Architecture (Phase 9)

This document describes the authenticated, read-only reporting layer built
on top of Phase 8's aggregation engine. It complements
`docs/ANALYTICS_ARCHITECTURE.md` (how raw events become pre-aggregated
statistics) and `docs/DATABASE_ARCHITECTURE.md` (what each collection
means) — this document covers how those statistics are turned into
dashboard-facing reports.

## 1. Where this fits

```
Client (authenticated dashboard)
  │  Authorization: Bearer <JWT>
  ▼
Route  (src/routes/reporting.routes.js)
  │
  ▼
authenticate            (Phase 2, reused — verifies the JWT, loads req.user)
  │
  ▼
verifyWebsiteOwnership   (Phase 9, new middleware — resolves :websiteId to
  │                       the caller's OWN website, or 404)
  ▼
Query validators         (Phase 9 — date range / granularity / pagination / sort)
  │
  ▼
Controller               (thin — no queries, no formulas)
  │
  ▼
reporting.service.js     (business logic — formulas, money conversion, shaping)
  │
  ▼
analytics repositories   (Phase 8's AnalyticsBucket/ProductAnalyticsBucket/
  │                        AnalyticsVisitorBucket/AnalyticsSessionBucket,
  │                        extended with new READ-only query methods)
  ▼
MongoDB (aggregation collections only — never Event)
  │
  ▼
Standard API response ({ success, data })
```

Nothing in this phase writes to any collection. Every endpoint is a `GET`.

## 2. Endpoints

All seven endpoints are mounted under `/api/reports/:websiteId/`, require
authentication, and require the caller to own `:websiteId` (the **public**
tracking id — the same identifier every Phase 8 collection is keyed by,
not `Website`'s internal `_id`).

| Endpoint | Purpose |
|---|---|
| `GET /overview` | Single summary across a date range — the main dashboard summary card |
| `GET /timeseries` | One point per bucket, for charting over time |
| `GET /products` | Top/paginated product performance list |
| `GET /products/:productId` | Detailed report for one product |
| `GET /conversion` | Funnel counts + all conversion rates |
| `GET /cart-checkout` | Cart and checkout activity |
| `GET /revenue` | Gross/net revenue, refunds, average order value |

Every endpoint accepts `from`, `to` (both required, ISO 8601), and an
optional `granularity` (`hour` or `day`, default `day`). `/products` also
accepts `sort`, `order`, `page`, `limit`.

## 3. Query flow in detail

1. **`authenticate`** (Phase 2, unmodified) — verifies the JWT, loads the
   user, rejects a suspended account. Populates `req.user`.
2. **`verifyWebsiteOwnership`** (new, `src/middleware/verifyWebsiteOwnership.js`)
   — validates `:websiteId`'s shape (reusing `isValidWebsiteId` from
   `src/utils/websiteId.js`), then resolves it through
   `websiteService.getWebsiteByWebsiteId(websiteId, req.user.id)` — a new
   service function that mirrors `getWebsite()`'s exact "same 404 whether
   the website doesn't exist or belongs to someone else" reasoning Phase 3
   established, just keyed by the public `websiteId` instead of the
   internal `_id`. Attaches the resolved (ownerId-stripped) website as
   `req.website`.
3. **Query validators** (`src/validators/reporting.validator.js`) —
   `validateReportQuery` (shared by all seven endpoints) parses/validates
   `from`/`to`/`granularity` together and attaches `req.reportQuery`
   (real `Date` objects, not raw strings) — the same `req.validated`
   convention `event.validator.js`/`website.validator.js` already
   established. `/products` additionally runs `validateProductSort` and
   `validatePagination`.
4. **Controller** (`src/controllers/reporting.controller.js`) — reads
   `req.website`/`req.reportQuery`/`req.pagination`/`req.sort`, calls the
   one matching `reporting.service.js` function, sends the response via
   the existing `sendSuccess` utility. No query, no formula, no formatting
   decision lives here.
5. **Service** (`src/services/analytics/reporting.service.js`) — calls one
   or two repository methods, applies the documented formulas (§6 below),
   converts money once, shapes the response.
6. **Repository** — a single MongoDB aggregation call per data need (§8).

## 4. Aggregation collection usage

| Report | Reads |
|---|---|
| Overview | `AnalyticsBucket` (summed), `AnalyticsVisitorBucket` + `AnalyticsSessionBucket` (distinct-count) |
| Time-series | `AnalyticsBucket` (per-bucket, unsummed) |
| Products (list) | `ProductAnalyticsBucket` (grouped/summed/sorted/paginated) |
| Product detail | `ProductAnalyticsBucket` (summed for one product); falls back to `Product` (Phase 6) for the name only when no analytics activity exists in range |
| Conversion | `AnalyticsBucket` (summed) + distinct visitor/session counts |
| Cart/checkout | `AnalyticsBucket` (summed) |
| Revenue | `AnalyticsBucket` (summed) |

**Nothing here queries `Event`.** `tests/reporting.security.test.js`
includes a dedicated test that mocks every `eventRepository` method to
throw if called, then exercises all seven endpoints and asserts zero
calls — a direct, executable proof of §17 ("No raw event recomputation"),
not just a code-review claim.

## 5. Why summary reports use TRUE distinct counts, not summed per-bucket uniques

This is the single most important correctness decision in this phase.
`AnalyticsBucket.uniqueVisitors`/`uniqueSessions` are already correct
**per bucket** (Phase 8 guarantees that). But summing that field across
*multiple* buckets — which every summary report (Overview, Conversion)
necessarily does when the requested range spans more than one bucket —
would **over-count**: a visitor active in both the 09:00 and 10:00 hour
buckets contributes 1 to each bucket's `uniqueVisitors`, but is one
distinct visitor across the combined range, not two.

Instead, `visitorAnalyticsRepository.countDistinctInRange()` /
`sessionAnalyticsRepository.countDistinctInRange()` (new in Phase 9) query
the underlying claim collections (`AnalyticsVisitorBucket`/
`AnalyticsSessionBucket`) directly:

```js
AnalyticsVisitorBucket.aggregate([
  { $match: { websiteId, granularity, bucket: { $gte: from, $lt: to } } },
  { $group: { _id: '$anonymousId' } },
  { $count: 'count' },
])
```

This still queries only an aggregation collection (never `Event`), and
gives the genuinely correct distinct count for the whole range. The
**time-series** report doesn't have this problem at all — each point
already represents exactly one bucket's own true count, so it reads
`AnalyticsBucket.uniqueVisitors`/`uniqueSessions` directly, per bucket, no
extra query needed.

## 6. Conversion formulas — reused from Phase 8, not reinvented

Every rate is computed fresh at response time from raw counters; **none**
is stored anywhere (`src/utils/analyticsFormulas.js`). Three formulas are
Phase 8 ANALYTICS_ARCHITECTURE.md §12's own definitions, reused verbatim:

```
visitorConversionRate  = orders / uniqueVisitors  × 100
sessionConversionRate  = orders / uniqueSessions   × 100
purchaseConversionRate = checkoutCompleted / checkoutStarted × 100
```

Phase 9 §5's own example, `"purchase conversion = orders / uniqueVisitors"`,
is the identical formula Phase 8 named `visitorConversionRate` — Overview's
single `conversionRate` field is exactly this value.

Phase 9 adds a small number of **new** formulas Phase 8 never defined at
all (not a redefinition of anything, since Phase 8's docs never claimed to
cover per-product or cart-funnel rates):

```
addToCartRate       = addToCarts / productViews × 100          (Conversion report)
cartToCheckoutRate  = checkoutStarted / cartsCreated × 100      (Cart/Checkout report)
viewToCartRate      = addToCarts / productViews × 100           (Product Detail — per-product)
cartToOrderRate     = orders / addToCarts × 100                 (Product Detail — per-product)
```

`averageOrderValue` and `averageItemsPerOrder`-style averages are computed
per Phase 8 §15's own guidance ("store counts, compute averages at
reporting time"):

```
averageOrderValue = grossRevenueMinor / orders     (computed on minor units, converted once — see §7)
```

Every formula above is implemented by exactly two small, pure, unit-tested
functions (`calculateRate`, `calculateAverage`,
`tests/analyticsFormulas.test.js`) that return `0` — never `NaN` or
`Infinity` — for a zero, negative, or non-finite denominator.

## 7. Money handling

All internal summation happens on integer minor-unit fields, via MongoDB
`$sum` (never a JavaScript loop, never accumulated as a float). Conversion
to a major-unit decimal happens via `src/utils/money.js`'s existing
`fromMinorUnits()` — reused, not reimplemented — exactly **once**, in the
service layer's final response-shaping step, after every summation has
already completed on the integer values. This is not floating-point money
accumulation: the float only ever exists as the single, final, displayed
number, never as an intermediate value anything else is added to.

`averageOrderValue` follows the same rule: `calculateAverage()` divides
the summed integer `grossRevenueMinor` by `orders` first (a single
division, not an accumulation), and *that* quotient is converted to major
units once, at the very end.

Every monetary report field (`grossRevenue`, `refundedAmount`,
`netRevenue`, `revenue`, `cartValue`, `averageOrderValue`) is a major-unit
number in the response, matching Phase 9 §1's field-name examples exactly.
`currency` is sourced from `Website.currency` (already resolved by
`verifyWebsiteOwnership` onto `req.website`) — the single authoritative
per-website currency, per Phase 8 ANALYTICS_ARCHITECTURE.md §17 ("every
website is expected to operate in one configured currency") — never from
summing/guessing across potentially-mixed bucket-level currency snapshots.

## 8. Date range and granularity behavior

- `from`/`to` are required, ISO 8601, parsed with `Date.parse` (rejects
  anything that doesn't produce a finite timestamp — no silent coercion).
- `from` must be `<=` `to`.
- Buckets are matched with `bucket >= from AND bucket < to` — a bucket
  "belongs" to the range if its own start time falls inside it. This is
  the same semantics Phase 8 buckets always had; Phase 9 doesn't reinterpret it.
- **UTC only.** Every bucket is stored in UTC (Phase 8 §16/§30); this
  reporting layer never applies `Website.timezone` to bucket boundaries or
  query filters — the aggregation layer's UTC decision is respected
  exactly as documented, not silently overridden here. A caller wanting
  timezone-localized day boundaries must currently pass `from`/`to`
  pre-converted to UTC on their own side; that conversion, if ever added
  server-side, belongs entirely in this reporting layer (per Phase 9 §8's
  own instruction) and is explicitly not implemented this phase.
- **"Reasonable date range"** (§8): bounded by granularity, since the
  bound exists to cap how many bucket documents one aggregation call
  touches — `MAX_RANGE_DAYS_BY_GRANULARITY` in
  `src/constants/reportingLimits.js`: **92 days** for `hour` granularity
  (~2,200 documents), **731 days** (2 years) for `day` granularity (~731
  documents). Both comfortably small for a single aggregation pipeline
  while covering every realistic dashboard use case. A range exceeding
  the bound for the requested granularity is rejected with
  `INVALID_DATE_RANGE`, not silently truncated.
- **Late events**: unaffected by this phase — a bucket's position is fixed
  at aggregation time (Phase 8 §31); the reporting layer just reads
  whatever bucket documents already exist.

## 9. Pagination (`/products` only)

```json
{ "items": [...], "pagination": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 } }
```

`page` defaults to 1, `limit` defaults to 20, capped at **100**
(`PAGINATION_MAX_LIMIT`) — a request for more is rejected
(`INVALID_PAGINATION`), never silently clamped, and never served as an
unbounded result set. Pagination is computed inside the SAME MongoDB
aggregation call that groups/sums/sorts the products, via a `$facet`
stage that produces `items` (skip/limit-ed) and `totalCount` together —
never a second, separate `count()` query (no N+1).

## 10. Sorting — explicit allow-list, never client-controlled field injection

`src/constants/reportingSort.js` maps a small, fixed set of public sort
names to the exact Mongo field names the products aggregation pipeline's
`$group` stage produces:

```js
{ revenue: 'revenueMinor', orders: 'orders', views: 'productViews', addToCart: 'addToCarts', purchaseQuantity: 'unitsSold' }
```

`validateProductSort` rejects anything not in this map before it ever
reaches a repository — `src/repositories/analytics/productAnalytics.repository.js`'s
`aggregateTopProducts()` only ever receives an already-resolved,
already-safe field name, never a raw query string. There is no code path
anywhere in this phase that interpolates `req.query.sort` directly into a
Mongo sort specification.

## 11. Multi-tenant isolation

Every repository method added this phase takes `websiteId` as its leading
filter argument, matching the leading field of the underlying collection's
unique index (so MongoDB can actually use that index). Product-level
queries additionally scope by `productId` alongside `websiteId` — the same
external product id can exist under two different websites as two
completely independent `ProductAnalyticsBucket` groups, verified directly
(`tests/reporting.products.test.js`, `tests/reporting.overview.test.js`).
Ownership enforcement (`verifyWebsiteOwnership`) happens **before** any
report query runs at all — a request for a website the caller doesn't own
never reaches the repository layer, it 404s at the middleware step.

## 12. Performance strategy

- Every report is answered by **one or two** MongoDB aggregation/query
  calls — never more, never a query-per-item loop (no N+1).
- Grouping, summing, sorting, and pagination all happen **inside MongoDB**
  (`$group`, `$sum`, `$sort`, `$facet`) — never in JavaScript after
  loading raw documents.
- No new indexes were added this phase. Every query filters by fields
  already covered by Phase 8's existing unique indexes
  (`{websiteId, granularity, bucket}` / `{websiteId, productId,
  granularity, bucket}` / `{websiteId, granularity, bucket, anonymousId}`
  / `{websiteId, granularity, bucket, sessionId}`) — the query patterns
  this phase needed were anticipated by Phase 8's own index design, so no
  new index is "genuinely necessary" per §15's own bar for adding one.
- Result sets are always bounded: pagination caps `/products` at 100 items
  per page; every other report returns a single summary object or, for
  time-series, at most `MAX_RANGE_DAYS_BY_GRANULARITY`-worth of bucket
  documents (≤ ~2,200 for hourly, ≤ 731 for daily).

## 13. Security model

- **Every endpoint requires authentication** (`authenticate`, Phase 2,
  reused unmodified) — no reporting endpoint is public.
- **Ownership, not role, is the access boundary** (matching Phase 3's own
  website-management design) — `verifyWebsiteOwnership` resolves
  `:websiteId` through `req.user.id`, never through any client-supplied
  value. There is no `ownerId` query parameter, body field, or header this
  layer ever reads.
- **404, not 403, for a website that exists but isn't the caller's** — the
  same anti-enumeration reasoning Phase 3 established: a 404 doesn't
  confirm to an attacker that a given `websiteId` exists at all.
- **No analytics data ever appears in an error response.** A denied
  request's response body contains only the standard error envelope
  (`{ success: false, message, error: { code } }`) — never a data field.
- **No new sensitive data exposure.** Every field returned by every report
  is a count, a money amount, a rate, a UTC date, or an already-public
  identifier (`websiteId`, `productId` = the external product id,
  `productName`). No password, token, card data, or raw request payload
  is reachable through this layer, by construction — it only ever reads
  the five Phase 8 aggregation collections plus (for product-name
  fallback only) `Product.name`.

## 14. Testing status

Comprehensive tests exist across every category in Phase 9 §19 — see
`tests/reporting.overview.test.js`, `reporting.timeseries.test.js`,
`reporting.products.test.js`, `reporting.revenue.test.js` (also covers
conversion + cart/checkout), `reporting.security.test.js`, and
`analyticsFormulas.test.js`. Production repository code uses real
Mongoose aggregation pipelines throughout; because no live MongoDB is
available in this development sandbox, tests mock at the repository
boundary with `tests/helpers/mockReportingPipeline.js` — an in-memory
implementation that mirrors the exact grouping/summing/sorting/pagination
semantics the real aggregation pipelines implement, so multi-tenant
isolation, date filtering, sorting, and pagination are exercised as real
correctness properties, not tautologies. The real MongoDB aggregation
pipelines themselves (the `$group`/`$sum`/`$facet` pipelines in
`src/repositories/analytics/*.js`) are unverified against a live database
— see the Phase 9 final report for this limitation stated plainly.
