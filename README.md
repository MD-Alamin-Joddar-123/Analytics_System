# Universal Ecommerce Analytics — Backend

## Purpose

Backend foundation for a production-grade, multi-tenant Universal Ecommerce
Analytics SaaS platform. This repository currently implements **Phase 1**
(server, database connection, error handling, logging, health check),
**Phase 2** (authentication and user management), **Phase 3** (website
management and the public `websiteId` used by the tracking script),
**Phase 4** (the universal, framework-agnostic event collection API),
**Phase 5** (visitor & session resolution), **Phase 6** (normalized
ecommerce data — Product/Cart/Checkout/Order — resolved from events),
**Phase 7** (a durable queue + background worker, so accepting an event and
processing it are separate, retryable steps), **Phase 8** (an internal
analytics aggregation engine that turns successfully processed events into
pre-aggregated, query-efficient hourly/daily statistics), and **Phase 9**
(an authenticated Analytics Reporting API that reads those statistics into
dashboard-ready reports — overview, time-series, product performance,
conversion, cart/checkout, and revenue). There is still no frontend
dashboard — Phase 9 is the API a future dashboard would call.

## Architecture Overview

```
src/
├── config/        environment loading, MongoDB/Redis connections, CORS,
│                   queue defaults, Swagger spec
├── routes/        Express routers (thin, no business logic)
├── controllers/   request/response handling
├── services/       business logic (e.g. services/auth/auth.service.js),
│                   including services/analytics/ (Phase 8 aggregation +
│                   Phase 9 reporting.service.js)
├── repositories/   data-access layer (e.g. user.repository.js), including
│                   repositories/analytics/ (Phase 8 aggregation collections,
│                   extended in Phase 9 with read-only reporting queries)
├── models/         Mongoose models + shared schema options
├── middleware/     request logging, 404, centralized error handler,
│                   authenticate (JWT), authorize (role checks),
│                   verifyWebsiteOwnership (Phase 9 reporting ownership check)
├── validators/     request validation (e.g. auth.validator.js,
│                   reporting.validator.js)
├── queues/         BullMQ queue definitions (event.queue.js)
├── workers/         background job processors (event.worker.js — a
│                    separate OS process, see "Running the System" below)
├── utils/          logger, ApiError, response helpers, password/JWT/safeUser
├── constants/      error codes, analytics metric mapping (Phase 8)
├── app.js          Express app assembly
└── server.js       API process entry point, startup, graceful shutdown
```

Responsibilities are kept separated: routes never contain business logic,
controllers never query the database directly, and business logic lives in
`services/` (which call `repositories/` for data access). As of Phase 7,
`services/event/` is itself split in two: `event.service.js` (ingestion —
validate, persist, enqueue) and `eventProcessing.service.js` (processing —
Visitor/Session/Commerce resolution). Phase 8 adds one more step to that
processing path — `services/analytics/analyticsAggregation.service.js` —
called from `eventProcessing.service.js` after commerce resolution and
before an Event is marked `completed`.

See [docs/DATABASE_ARCHITECTURE.md](docs/DATABASE_ARCHITECTURE.md) for the
multi-tenant data model,
[docs/QUEUE_ARCHITECTURE.md](docs/QUEUE_ARCHITECTURE.md) for the queue,
worker, retry, and graceful-shutdown design,
[docs/ANALYTICS_ARCHITECTURE.md](docs/ANALYTICS_ARCHITECTURE.md) for how
processed events become pre-aggregated statistics, and
[docs/REPORTING_API_ARCHITECTURE.md](docs/REPORTING_API_ARCHITECTURE.md)
for how those statistics are read back out as reports.

## Technology Stack

- Node.js (ES Modules)
- Express.js
- MongoDB + Mongoose
- Redis + BullMQ (durable event-processing queue) + ioredis
- Helmet (security headers)
- CORS
- dotenv (environment configuration)
- Structured JSON logging (no external logging dependency yet)
- bcryptjs (password hashing)
- jsonwebtoken (JWT auth)
- swagger-ui-express (interactive API docs)

## Setup

```bash
cd backend
npm install
cp .env.example .env   # then edit values as needed
```

## Environment Variables

| Variable        | Description                                              |
|------------------|-----------------------------------------------------------|
| `PORT`           | Port the HTTP server listens on                          |
| `NODE_ENV`       | `development`, `production`, or `test`                   |
| `MONGODB_URI`    | MongoDB connection string                                 |
| `CORS_ORIGINS`   | Comma-separated list of allowed CORS origins               |
| `JWT_SECRET`     | Secret used to sign/verify JWT access tokens (Phase 2)     |
| `JWT_EXPIRES_IN` | JWT access token lifetime, e.g. `7d` (Phase 2)              |
| `SESSION_TIMEOUT_MINUTES` | Inactivity window before a session expires, default `30` (Phase 5) |
| `REDIS_URL`      | Redis connection string, e.g. `redis://127.0.0.1:6379` (Phase 7) |
| `WORKER_CONCURRENCY` | How many jobs one worker process handles at once, default `5` (Phase 7) |
| `QUEUE_ATTEMPTS` | Max processing attempts per event before it's left in `failed` state, default `5` (Phase 7) |
| `QUEUE_BACKOFF`  | Base exponential backoff delay (ms) between retries, default `1000` (Phase 7) |

`.env` is git-ignored and must never be committed. Use `.env.example` as the
template for required variables. None of `REDIS_URL`, `MONGODB_URI`, or the
JWT/queue settings are ever returned by any API response, including
`/health` — see "Health Check" below.

## Database & Queue Setup

The API server requires a reachable **MongoDB** instance at `MONGODB_URI`
and, since Phase 7, a reachable **Redis** instance at `REDIS_URL` — event
processing goes through a real BullMQ/Redis queue, never an in-memory
array, so the queue survives a process restart. On startup, the server
connects to MongoDB before it starts listening for requests; if that
connection fails, the process logs the error and exits rather than serving
traffic without a database. If Redis is unreachable when `POST
/api/collect` tries to enqueue a job, the Event is still safely persisted,
but the request returns `503 QUEUE_UNAVAILABLE` rather than falsely
claiming the event will be processed — see
[docs/QUEUE_ARCHITECTURE.md](docs/QUEUE_ARCHITECTURE.md).

Local MongoDB example:

```bash
mongod --dbpath ./data
```

Local Redis example:

```bash
redis-server
```

Or point `MONGODB_URI` / `REDIS_URL` at managed instances (MongoDB Atlas,
a managed Redis).

## Running the System

The API server and the event-processing worker are **separate processes**
— starting the API does not start the worker, and vice versa (Phase 7
§20: worker startup is always explicit, never a side effect).

```bash
# Terminal 1 — API server (development: auto-restart on file changes)
npm run dev
# or, production:
npm start

# Terminal 2 — worker (development: auto-restart on file changes)
npm run worker
# or, production:
npm run start:worker
```

Both processes need `MONGODB_URI` and `REDIS_URL` pointing at the same
MongoDB and Redis instances. `POST /api/collect` will accept and persist
events even with no worker running — they simply queue up as
`processingStatus: 'pending'` until a worker process is started to work
through them.

## Health Check

```
GET /health
```

Response:

```json
{
  "success": true,
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "queue": "ready",
  "uptime": 12.345,
  "timestamp": "2026-08-20T10:00:00.000Z"
}
```

Returns HTTP 503 with `status: "degraded"` if MongoDB, Redis, or the queue
is not available — `"healthy"` requires every dependency the collector
actually needs, not just the database.

## Error Response Format

```json
{
  "success": false,
  "message": "Route not found: GET /unknown",
  "error": {
    "code": "NOT_FOUND"
  }
}
```

In development, `error.stack` is also included for debugging. Production
responses never expose stack traces, internal paths, or credentials.

## Authentication (Phase 2)

JWT-based authentication with bcrypt-hashed passwords. Tokens are stateless
and signed with `JWT_SECRET`, expiring after `JWT_EXPIRES_IN`.

### Endpoints

| Method | Path                  | Auth required | Description                     |
|--------|-----------------------|:-------------:|----------------------------------|
| POST   | `/api/auth/register`  | No            | Create a new user account        |
| POST   | `/api/auth/login`     | No            | Exchange credentials for a JWT   |
| GET    | `/api/auth/me`        | Yes           | Get the current authenticated user |
| POST   | `/api/auth/logout`    | Yes           | Acknowledge logout (see below)   |

### Register

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","password":"secure-password"}'
```

Returns `201` with `{ success: true, data: { user, token } }`. `passwordHash`
is never included in the response — the user model excludes it from queries
by default (`select: false`) and strips it again in serialization as a
defense-in-depth measure.

### Login

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"secure-password"}'
```

Returns `200` with `{ success: true, data: { user, token } }`. Invalid email
and invalid password both return the same generic `401 INVALID_CREDENTIALS`
message ("Invalid email or password.") to avoid leaking which part was
wrong. A suspended account returns `403 ACCOUNT_SUSPENDED`.

### Authenticated request

```bash
curl http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer <token>"
```

The `authenticate` middleware validates the token, confirms the user still
exists and is active, and attaches `req.user = { id, email, role, status }`
for downstream handlers — this is what Website Management (Phase 3, below)
and later phases use for ownership checks.

Role-based access is prepared via `requireRole(...roles)` in
`src/middleware/authorize.js` (e.g. `requireRole('admin')`), though no
admin-only routes exist yet.

### Logout

JWT access tokens are stateless, so the server cannot unilaterally
invalidate one already issued. `POST /api/auth/logout` (authenticated)
returns a success response, but **the client is responsible for discarding
the token** — it remains cryptographically valid until it expires. The
service layer (`authService.logout`) is the deliberate seam where real
revocation (a `tokenVersion` on the user, or a short-lived denylist keyed by
JWT id) can be added later without changing the API contract.

## Website Management (Phase 3)

Every authenticated user can create and manage their own websites — the
root resource for the multi-tenant model. Each website gets a public
`websiteId` (distinct from its internal MongoDB `id`) that will later be
embedded in the tracking script:

```html
<script src="https://analytics.yourdomain.com/tracking.js" data-website-id="a1b2c3d4e5f60718"></script>
```

### Endpoints

| Method | Path                  | Description                          |
|--------|-----------------------|----------------------------------------|
| POST   | `/api/websites`       | Create a website                       |
| GET    | `/api/websites`       | List the caller's own websites         |
| GET    | `/api/websites/:id`   | Get one website (by internal id)       |
| PATCH  | `/api/websites/:id`   | Update name/domain/timezone/currency/status |
| DELETE | `/api/websites/:id`   | Archive (soft-delete) a website        |

All five require `Authorization: Bearer <token>` — there's no admin
override; ownership (`ownerId === req.user.id`), not role, is the access
boundary here.

### Create a website

```bash
curl -X POST http://localhost:5000/api/websites \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Ecommerce Store","domain":"https://example.com","timezone":"Asia/Dhaka","currency":"BDT"}'
```

`ownerId`, `websiteId`, `_id`, `createdAt`, and `updatedAt` are always
server-generated — any of those fields sent in the request body are simply
ignored, never trusted.

### Ownership isolation

`GET`/`PATCH`/`DELETE /api/websites/:id` all resolve `:id` scoped to the
caller (`Website.findOne({ _id, ownerId })` — enforced in the repository
query itself, not as an after-the-fact check). Requesting another user's
website returns `404 WEBSITE_NOT_FOUND` — the same response as a
nonexistent id, so the endpoint can't be used to probe which website ids
exist for other accounts.

### Domain normalization

Domains are stored as a lowercase hostname only — `https://example.com/`,
`http://example.com`, and `example.com` all normalize to `example.com`.
`www.example.com` is **not** merged with `example.com` — they're treated as
distinct domains, since a subdomain can be a genuinely different property.
See `src/utils/domain.js` for the full rule set.

### Archiving (soft delete)

`DELETE` sets `status: 'archived'` rather than physically deleting the
record — future analytics collections will reference a website by its
internal id, so hard-deleting it would orphan that history. Archiving is
idempotent, and once archived a website becomes immutable
(`PATCH` → `409 WEBSITE_ARCHIVED`). `POST /api/collect` (Phase 4, below)
rejects events for a non-`active` website even though its `websiteId`
remains valid and public.

## Event Collection (Phase 4)

The universal ingestion endpoint every tracking snippet sends to,
regardless of what the customer's website is built with:

```
POST /api/collect
```

**No `Authorization` header.** This is deliberate, not an oversight: the
caller is a script embedded in a customer's own website, not our
authenticated dashboard. The request identifies which *website* the event
belongs to via the public `websiteId` in the body — the same non-secret
identifier from Website Management above — not via a bearer token.
Requiring a dashboard JWT here would make the endpoint unusable from a
tracking snippet.

### Request

```bash
curl -X POST http://localhost:5000/api/collect \
  -H "Content-Type: application/json" \
  -d '{
    "websiteId": "a1b2c3d4e5f60718",
    "event": "add_to_cart",
    "url": "https://store.com/product/123",
    "data": { "productId": "p123", "name": "Laptop", "price": 85000, "quantity": 1, "currency": "BDT" }
  }'
```

Supported `event` values: `page_view`, `product_view`, `add_to_cart`,
`remove_from_cart`, `checkout`, `purchase`. Each has its own `data` shape
(see `/api-docs`); an unrecognized event name is rejected
(`400 UNSUPPORTED_EVENT`), including names reserved for future phases
(`search`, `payment`, `custom`, etc. — listed in
`src/constants/eventTypes.js` but not yet enabled).

### Response

New event:

```json
{ "success": true, "data": { "accepted": true, "eventId": "..." } }
```
→ `202 Accepted` — **accepted for processing, not yet processed** (Phase 7):
the Event is durably persisted and a job has been queued; Visitor/Session
resolution and any Product/Cart/Order updates happen shortly after, in a
background worker, not before this response is returned. See
[docs/QUEUE_ARCHITECTURE.md](docs/QUEUE_ARCHITECTURE.md).

Duplicate (same `websiteId` + `eventId` already recorded):

```json
{ "success": true, "data": { "accepted": true, "duplicate": true, "eventId": "..." } }
```
→ `200 OK` — nothing new was created; this is still a success, not an error.

Queue unavailable (Phase 7): if the Event was persisted but the processing
job could not be queued (e.g. Redis is down), the response is
`503 QUEUE_UNAVAILABLE` — the API never claims an event will be processed
when it can't guarantee that. The Event itself is never lost or deleted in
this case; see "Redis/queue failure" in
[docs/QUEUE_ARCHITECTURE.md](docs/QUEUE_ARCHITECTURE.md).

### Idempotency

Identity is the pair **`websiteId` + `eventId`**, enforced by a unique
database index. Send your own `eventId` if your SDK needs guaranteed
idempotent retries (network blips, browser resubmits); omit it and the
server generates a UUID. The same `eventId` on two different websites is
two independent events. As of Phase 7, the same guarantee also protects
the queue: a job's id is deterministically derived from `websiteId` +
`eventId`, so re-submitting a duplicate event can never create a second
processing job either.

### Timestamps

`timestamp` (when the event happened) and `receivedAt` (when this server
accepted it) are stored separately. Send `timestamp` if you have it —
arbitrarily old values are fine (e.g. replaying events queued while
offline); values more than ~5 minutes in the future are rejected
(`400 INVALID_TIMESTAMP`) rather than trusted. Omit it and `timestamp`
defaults to `receivedAt`.

### Website status gating

- `active` → accepted.
- `archived` → `403 WEBSITE_ARCHIVED`.
- `paused` → `403 WEBSITE_PAUSED` — rejected outright rather than
  accepted-but-flagged, so "paused" has exactly one meaning everywhere in
  the system.
- Unknown `websiteId` → `404 WEBSITE_NOT_FOUND`.

### Security & abuse resistance

Since this endpoint can't be protected by authentication, it's protected
by everything else: a 32KB request body cap (well over what any real event
needs — even a checkout with several line items), strict per-event field
validation with length/count limits (e.g. at most 100 items per
cart/order), and a best-effort in-memory rate limiter per IP
(`src/middleware/rateLimiter.js` — explicitly **not** production-grade
distributed protection; it's a placeholder establishing where a real
Redis-backed limiter will plug in later without touching the collector's
validation or business logic).

CORS for this route is configured separately from the rest of the API: it
reflects any `Origin` with `credentials: false`, because the clients are
arbitrary customer websites we can't allowlist in advance, and no
cookie/credentialed action is ever performed here — the dashboard's
CORS policy (`CORS_ORIGINS` allowlist + credentials) intentionally does not
apply to `/api/collect`.

Only an explicit allow-list of fields is ever persisted from the request —
per event type, only its defined fields are read out of the client's
`data` object and copied into a new object. Anything else (`password`,
`cvv`, a smuggled `ownerId`, etc.) is never read, so it can't end up in the
database no matter what a client sends.

## Visitor & Session Resolution (Phase 5)

`POST /api/collect` now resolves the `anonymousId`/`sessionId` a client
sends into real `Visitor`/`Session` documents — internally, as a side
effect of event collection. **There is no separate Visitor/Session API**;
they're not readable or writable except through this pipeline.

### Identity stays pseudonymous

A visitor is identified by **`websiteId + anonymousId` only.** Never IP
address, email, phone, password, or a browser fingerprint — the backend is
structurally incapable of building a cross-site profile from this data,
because the same `anonymousId` on two different websites always produces
two independent visitors. A session is identified by **`websiteId +
sessionId`** and always belongs to exactly one visitor.

### How an event resolves to a visitor and session

```
anonymousId  →  Visitor  (websiteId + anonymousId; created on first sight)
sessionId    →  Session  (websiteId + sessionId; reused if active, else a new one starts)
```

Both are optional, and the collector remains fully functional without
them:

| Sent by client                  | Result                                                             |
|----------------------------------|---------------------------------------------------------------------|
| Neither                          | Event accepted, unidentifiable — no Visitor/Session created         |
| `anonymousId` only                | Visitor resolved; a fresh single-event Session is created each time (nothing correlates repeated events without a persisted `sessionId` — send one for real session grouping) |
| `anonymousId` + `sessionId`       | Visitor resolved; Session reused while active, or a new one starts once `SESSION_TIMEOUT_MINUTES` of inactivity has passed |

A session's inactivity timeout continuation gets a **new, server-generated
`sessionId`** — the original string is permanently tied to the ended
session (unique index), so it can never be reused for a second document.
The event's own `sessionId` field always records exactly what the client
sent, unmodified, even in this case; `sessionObjectId` points at whichever
session document actually received the event. See
`docs/DATABASE_ARCHITECTURE.md` for the full rationale.

### Counters never double-count a retry

`eventCount`, `sessionCount`, and `pageViewCount` only increment once an
event is confirmed to be genuinely new — never for a duplicate caught by
Phase 4's `websiteId + eventId` idempotency check, whether that duplicate
is caught before touching the database or by losing a race on the unique
index at insert time. Visitor/Session *resolution* (find-or-create) can
safely run ahead of that check being fully settled because it's itself
idempotent; the *counter updates* are gated strictly behind a successful,
non-duplicate insert.

## Normalized Ecommerce Data (Phase 6)

`POST /api/collect` now also normalizes `product_view`/`add_to_cart`/
`remove_from_cart`/`checkout`/`purchase` events into six commerce
entities — `Product`, `Cart`, `CartItem`, `Checkout`, `Order`, `OrderItem`.
**There is no public API for these either** — same as Visitor/Session,
they exist only as a side effect of event collection.

### Universal normalization, not schema mirroring

A Shopify store, a WooCommerce store, and a hand-rolled React storefront
all have different internal schemas. This system doesn't represent any of
them directly — it defines one event contract and normalizes whatever
arrives into its own model. External ids (`externalProductId`,
`externalOrderId`, `cartId`, `checkoutId`) are always treated as plain
strings, never assumed numeric, and never equal to our own MongoDB `_id`.

### Money: integer minor units, never floats

Every monetary field on these entities (`Product.price`, `Cart.subtotal`,
`Order.total`, `OrderItem.unitPrice`, ...) is stored as an **integer in
minor units** — `850.50` becomes `85050`, converted once via
`src/utils/money.js`. No stored financial value is ever a JS float or the
result of float arithmetic. (`Event.data` itself is unaffected — it keeps
storing the raw major-unit number the client sent, as it always has.)

### Extended event payloads (backward compatible)

The Phase 4 contract still works unchanged. Phase 6 only adds optional
fields:

```json
{
  "websiteId": "a1b2c3d4e5f60718",
  "event": "purchase",
  "data": {
    "orderId": "ORDER-123",
    "revenue": 170000,
    "currency": "BDT",
    "items": [{ "productId": "p1", "name": "Laptop", "price": 85000, "quantity": 2 }],
    "checkoutId": "chk-456",
    "subtotal": 170000,
    "discount": 0,
    "shipping": 0,
    "tax": 0,
    "total": 170000,
    "paymentStatus": "paid"
  }
}
```

`add_to_cart`/`checkout`/`purchase` gained an optional `cartId`/
`checkoutId` for linking to a Cart/Checkout; `remove_from_cart` no longer
requires `price` (Phase 4 required it; Phase 6 doesn't need it to remove a
line). Every new field is optional — omitting all of them reproduces
exactly the old Phase 4 behavior.

### Cart behavior

`add_to_cart` and `remove_from_cart` quantities are **incremental** — "add
2 more" / "remove 1," not "the cart now has N of this." Adding a product
already in the cart increments its `CartItem.quantity` rather than
creating a second line; removing more than is present clamps at zero and
deletes the line instead of ever going negative.

### Order idempotency: a second, necessary guarantee

Beyond Phase 4/5's `websiteId + eventId` event idempotency, orders get
their own: `websiteId + externalOrderId`. This matters because two
*different* events (different `eventId`s — a retry, or two separate
webhook deliveries for the same order) can reference the same order, and
event-level idempotency alone can't catch that. A second purchase event
for a known order **updates** it (status/payment fields legitimately
evolve over an order's lifecycle) but never creates a second `Order`
document, and `OrderItem`s are created exactly once — only when the order
is first created, never on a later update.

### Order/checkout total validation

If a client sends a full breakdown (`subtotal`, `discount`, `shipping`,
`tax`, AND `total` together), they must reconcile
(`subtotal - discount + shipping + tax = total`, ±0.01) or the event is
rejected. A partial breakdown is accepted without cross-checking. See
`docs/DATABASE_ARCHITECTURE.md` for the full policy.

## Reliable Event Processing — Queue & Worker (Phase 7)

Through Phase 6, Visitor/Session resolution and Commerce processing ran
*inside* the `POST /api/collect` request. That had a gap: if the Event
saved but that downstream work then failed, a client retry would be
recognized as a duplicate and the failed work would never automatically
run again. Phase 7 closes it by moving all of that out of the request,
onto a durable queue processed by a separate worker. Full design in
[docs/QUEUE_ARCHITECTURE.md](docs/QUEUE_ARCHITECTURE.md) — summary below.

### What changed in the request path

`POST /api/collect` now only does: validate → check the website → check
for a duplicate → persist the Event → enqueue a processing job → respond.
It does **not** wait for Visitor/Session resolution or any Product/Cart/
Order work — those happen afterward, in the worker. The endpoint is
correspondingly faster and its behavior more predictable: a slow or
failing downstream step can no longer make `/api/collect` itself slow or
fail.

### Processing state on the Event

Every Event now carries:

| Field | Meaning |
|---|---|
| `processingStatus` | `pending` → `processing` → `completed`, or → `failed` (retryable) |
| `processingAttempts` | how many times processing has been attempted |
| `lastProcessingAttemptAt` | when the most recent attempt started |
| `processedAt` | when processing last completed successfully |
| `lastProcessingError` | the most recent failure's message (capped, never a raw payload dump) |

These are internal/operational fields, not part of the public collector
contract — they exist for the worker and for future
debugging/reconciliation tooling, not for arbitrary clients to read.

### Retries and failure

Each event gets up to `QUEUE_ATTEMPTS` processing attempts (default 5),
with exponential backoff (`QUEUE_BACKOFF` as the base delay) between them.
A job that keeps failing is **never silently discarded**: it stays failed
and visible (`processingStatus: 'failed'`, plus the job itself retained in
Redis — `removeOnFail: false`) for later inspection or a future
retry/reconciliation tool, rather than disappearing.

### Idempotency — nothing new, extended

Phase 7 doesn't introduce a second idempotency system. The same unique
indexes and find-then-create patterns from Phases 3–6
(`Visitor`/`Session`/`Product`/`Cart`/`CartItem`/`Checkout`/`Order`) are
what make it safe for a job to run more than once — a retry after a crash
re-resolves the same identities and finds the same documents rather than
creating duplicates. On top of that, the worker skips all reprocessing
entirely for an event whose `processingStatus` is already `'completed'`,
which is what stops a plain retry from double-incrementing
Visitor/Session/Cart counters.

### Running it

See "Running the System" above — the worker is a separate process
(`npm run worker` / `npm run start:worker`) from the API server, and must
be started explicitly; it never starts automatically as a side effect of
running the API.

## Analytics Aggregation Engine (Phase 8)

Phase 8 adds one more step to the worker's processing pipeline, after
Visitor/Session/Commerce resolution and before an Event is marked
`completed`: turning that event into pre-aggregated analytics counters.
Full design, including the idempotency/consistency model, in
[docs/ANALYTICS_ARCHITECTURE.md](docs/ANALYTICS_ARCHITECTURE.md) — summary
below.

```
Event processing (Phase 7, unchanged)
  → Visitor/Session resolution
  → Commerce resolution (Product/Cart/Checkout/Order)
  → Analytics aggregation (Phase 8, new)
  → Event marked `completed`
```

**What gets aggregated.** Page metrics (views, unique visitors, unique
sessions), product metrics (views, add/remove-to-cart, units sold),
cart activity (carts created, items/quantity/value added — explicitly
*not* revenue), checkout metrics (started/completed), and order/revenue
metrics (orders, units sold, gross/net revenue) — all in integer minor
units, all scoped to `websiteId`, all bucketed into UTC hour and day
windows (`AnalyticsBucket`/`ProductAnalyticsBucket`).

**Only successfully processed events count.** An event only contributes to
analytics once it makes it all the way through Visitor/Session/Commerce
resolution *and* aggregation itself succeeds — a failure at any point
retries the whole attempt via the same Phase 7 queue/retry mechanism,
never partially applies analytics and moves on.

**No double-counting on retry.** A dedicated idempotency marker
(`AnalyticsEventProcessed`, keyed on `websiteId + eventId`) is claimed
before aggregation runs and released if aggregation fails, so a BullMQ
retry of a job that already applied its analytics never re-applies them —
see `docs/ANALYTICS_ARCHITECTURE.md` §13 for the exact consistency
guarantee (at-most-once, not exactly-once, and why).

**Not built this phase, on purpose:** no public reporting API (no
`GET /analytics`, no `GET /reports`), no dashboard, no `tracking.js` SDK
changes, no currency conversion, no profit calculation (no reliable
product-cost data exists to compute it from). This phase produces the
statistics; exposing them is later work.

## Analytics Reporting API (Phase 9)

Phase 9 exposes Phase 8's pre-aggregated statistics through an
authenticated, read-only reporting API. Full design in
[docs/REPORTING_API_ARCHITECTURE.md](docs/REPORTING_API_ARCHITECTURE.md)
— summary below.

```
GET /api/reports/:websiteId/overview        summary card: pageViews, orders, revenue, conversionRate, ...
GET /api/reports/:websiteId/timeseries      hourly/daily points for charting
GET /api/reports/:websiteId/products        top/paginated product performance (sortable)
GET /api/reports/:websiteId/products/:id    detailed report for one product
GET /api/reports/:websiteId/conversion      funnel counts + all conversion rates
GET /api/reports/:websiteId/cart-checkout   cart/checkout activity (cartValue is NOT revenue)
GET /api/reports/:websiteId/revenue         gross/net revenue, refunds, average order value
```

Every endpoint requires `Authorization: Bearer <JWT>` and only ever
returns data for a website the authenticated user owns — `:websiteId` is
resolved through a new `verifyWebsiteOwnership` middleware
(`src/middleware/verifyWebsiteOwnership.js`) that mirrors Phase 3's own
ownership pattern (same 404-for-both-"missing"-and-"not-yours" reasoning),
just keyed by the public `websiteId` reporting routes are addressed by
rather than `Website`'s internal `_id`. Every report accepts `from`/`to`
(required, ISO 8601) and `granularity` (`hour`/`day`, default `day`); the
product list additionally accepts `sort`/`order` (an explicit allow-list —
see the doc for why) and `page`/`limit` (capped at 100).

**This layer reads only Phase 8's aggregation collections — never Event.**
`AnalyticsBucket`/`ProductAnalyticsBucket` are summed via MongoDB
`$sum`/`$group` (never in JavaScript); `uniqueVisitors`/`uniqueSessions`
on multi-bucket summary reports use a true distinct count from
`AnalyticsVisitorBucket`/`AnalyticsSessionBucket` rather than naively
summing each bucket's own already-correct-per-bucket unique count (which
would over-count a visitor active in more than one bucket — see the doc's
§5 for the full reasoning). Every conversion rate is computed fresh at
response time from raw counters, reusing Phase 8's own documented
formulas where they apply — nothing is stored. Every rate/average safely
returns `0` for a zero denominator, never `NaN`/`Infinity`.

## Dashboard Frontend (Phase 10)

A dedicated frontend dashboard lives in [`../frontend`](../frontend) —
its own npm project (React + Vite + TypeScript), completely separate from
this backend, communicating with it only over the Phase 9 Reporting API
and Phase 2 auth endpoints. Full design in
[docs/DASHBOARD_ARCHITECTURE.md](docs/DASHBOARD_ARCHITECTURE.md); setup
and run instructions in [`frontend/README.md`](../frontend/README.md).

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_BASE_URL — defaults to http://localhost:5000
npm run dev            # http://localhost:3000, matching this backend's default CORS_ORIGINS
```

This backend's API contract was not changed to accommodate the frontend —
the dashboard adapts to the Phase 9 response shapes exactly as they are.

## Tracking SDK (Phase 11)

A universal, framework-agnostic browser tracking script lives in
[`../frontend/sdk`](../frontend/sdk) — a separate, dependency-free npm
project from both this backend and the dashboard, built as a single
minified script customers embed via one `<script>` tag. Full design in
[docs/SDK_ARCHITECTURE.md](docs/SDK_ARCHITECTURE.md); customer-facing
usage in [docs/SDK_INTEGRATION.md](docs/SDK_INTEGRATION.md).

```bash
cd frontend/sdk
npm install
npm run build   # outputs directly to backend/public/tracking.js
```

Once built, this backend serves it at `GET /tracking.js` — the only
backend change Phase 11 made (a static-file route; no existing business
logic, model, or endpoint was modified). The full local installation
snippet becomes:

```html
<script src="http://localhost:5000/tracking.js" data-website-id="abc123"></script>
```

## API Documentation

Interactive OpenAPI/Swagger docs are served at:

```
GET /api-docs
```

## Tests

```bash
npm test
```

Runs the full Phase 1–9 verification suite (server startup, health check,
404 handling, error response shape, password hashing, JWT
signing/verification, registration, login, `/me`, logout, role
authorization, domain normalization, websiteId generation, website
create/list/get/update/archive, cross-user ownership attacks, the full
`/api/collect` surface, visitor/session resolution, and the Phase 6
commerce layer — see the Phase 1–6 sections above for the detailed
breakdown) using Node's built-in test runner, plus the Phase 7 additions:

- **Queue configuration**: deterministic job id construction, retry/backoff
  values read from `env`, failed-job retention — and a small in-memory
  fake queue demonstrating the deduplication concept BullMQ's real jobId
  handling relies on (`tests/queue.test.js`).
- **Worker/processing core**: `eventProcessingService.processEvent()`
  tested directly (no queue involved) — missing-Event handling,
  successful processing invoking Visitor/Session/Commerce resolution,
  the already-completed no-op guard, processing failure marking the
  event `failed` with the error message and incrementing
  `processingAttempts`, and a simulated retry succeeding on a second
  attempt (`tests/eventProcessing.service.test.js`).
- **Ingestion behavior**: `202`/duplicate `200` responses, the event
  persisted before the queue is touched, re-enqueueing on a duplicate
  resubmission, and `503 QUEUE_UNAVAILABLE` when queue submission itself
  fails (`tests/collect.idempotency.test.js`).
- **Health**: database/Redis/queue reported independently, and the
  overall `healthy`/`degraded` combination logic (`tests/health.test.js`).
- **Graceful shutdown**: every shutdown function
  (`disconnectRedis`, `eventQueueService.close`, `disconnectDatabase`) is
  idempotent and never throws when there's nothing to close
  (`tests/shutdown.test.js`).

...and the Phase 8 additions:

- **Event → metric mapping**: every `mapEventToBucketIncrements`/
  `mapEventToProductOperations` case (page/product/cart/checkout/order),
  pure and mock-free (`tests/analyticsMetrics.test.js`).
- **UTC bucket math**: hour/day truncation, boundary conditions, and
  late-event bucketing by the event's own timestamp, never `receivedAt`
  or "now" (`tests/analyticsBucket.service.test.js`).
- **Schema/index verification**: every analytics model's declared unique
  compound index and required `websiteId`, inspected via Mongoose's
  schema API without a live database (`tests/analyticsModels.test.js`).
- **Aggregation correctness**: idempotency (same event aggregated twice →
  once), retry-after-failure (the compensating marker release actually
  un-blocks a retry), cross-website isolation (including the same product
  id under two websites), page/product/cart/checkout/order/revenue
  metrics, duplicate-order/duplicate-checkout protection, currency
  snapshotting, and — using `Promise.all` over up to 100 concurrent
  events against atomic-`$inc`-shaped mocks — that concurrent page views,
  add-to-carts, and purchases never land on anything but the exact
  expected count (`tests/analyticsAggregation.service.test.js`).
- **End-to-end wiring**: a full `POST /api/collect` → worker →
  aggregation funnel (page_view through purchase) asserted against the
  resulting bucket documents, plus duplicate-submission and cross-website
  scenarios through the real HTTP/service stack
  (`tests/analyticsEndToEnd.test.js`).

...and the Phase 9 additions:

- **Formulas**: `calculateRate`/`calculateAverage`/`calculateConversionRates`
  — every zero/negative/non-finite-denominator case, pure and mock-free
  (`tests/analyticsFormulas.test.js`).
- **Overview**: correct summed metrics, true-distinct-count
  `uniqueVisitors`/`uniqueSessions` (not a naive sum across buckets), empty
  range, zero-denominator conversion rate, date filtering, multi-tenant
  isolation (`tests/reporting.overview.test.js`).
- **Time-series**: hourly and daily points, ascending bucket ordering,
  date filtering, unsupported-granularity rejection
  (`tests/reporting.timeseries.test.js`).
- **Products**: top-products sorting (every allow-listed field), sort
  injection rejection, pagination (page/limit/total/totalPages, safe
  maximum), product-level multi-tenant isolation, product detail
  (known-but-quiet vs. entirely-unknown 404, per-product conversion
  rates) (`tests/reporting.products.test.js`).
- **Revenue / conversion / cart-checkout**: gross/net revenue, refund
  handling, average-order-value zero-order safety, float-drift-free
  multi-bucket summation, the full conversion-rate set, and cart value
  never contaminating a revenue field (`tests/reporting.revenue.test.js`).
- **Security**: unauthenticated requests, cross-user/cross-website
  access (404, no data leakage, ownership never trusted from a
  client-supplied value), invalid websiteId/productId, invalid/missing
  dates, oversized date ranges, and a dedicated performance test that
  mocks every `eventRepository` method to throw if called, then sweeps
  all seven endpoints asserting zero Event-collection calls
  (`tests/reporting.security.test.js`).

Route-level tests exercise the real Express app and
service/controller/validator/middleware layers end-to-end, with only the
repository and `eventQueueService` boundaries mocked — no live MongoDB or
Redis instance is required to run them. Visitor/session/commerce tests use
shared in-memory mocks (`tests/helpers/mockCollectPipeline.js`,
`tests/helpers/mockCommercePipeline.js`) that simulate the real
duplicate-key/unique-index behavior those repositories rely on, so
multi-request flows (timeout, reuse, races, order evolution) are exercised
realistically — and since Phase 7 moved that work out of the request, most
of those tests now use `tests/helpers/postAndProcess.js` to POST an event
and then directly invoke the same processing function the worker calls,
"playing the worker's part" synchronously within the test.

## Phase Scope

This platform implements Phase 1 (foundation) through Phase 12
(production readiness & end-to-end verification) — see
[docs/PRODUCTION_INTEGRATION_GUIDE.md](docs/PRODUCTION_INTEGRATION_GUIDE.md)
for the complete, top-to-bottom walkthrough (account → website →
tracking script → dashboard) tying every phase together, and each
phase's own `docs/*_ARCHITECTURE.md` for depth:

- **Phase 1-4**: foundation, auth, website management, universal event
  collection (`POST /api/collect`).
- **Phase 5-6**: visitor/session resolution, normalized ecommerce data
  (Product/Cart/Checkout/Order/OrderItem).
- **Phase 7-9**: a durable BullMQ/Redis queue + worker, internal analytics
  aggregation, and the authenticated Reporting API.
- **Phase 10**: the analytics dashboard (`frontend/`).
- **Phase 11**: the universal browser tracking SDK (`frontend/sdk/`,
  served at `GET /tracking.js`) — the single `<script>` tag integration.
- **Phase 12**: a final security audit, production environment
  documentation, and an end-to-end pipeline test proving every phase's
  seam is actually connected (`tests/endToEnd.pipeline.test.js`).

Explicitly **not** implemented, by deliberate, documented design: profit
calculation (no trusted product-cost data source exists —
`docs/PRODUCTION_INTEGRATION_GUIDE.md` §12), currency conversion,
week/month aggregation granularity (the architecture supports adding it
without a redesign, but only hour/day exist today), website-timezone
presentation in reports (buckets stay UTC), per-product
checkout-line-quantity tracking (Phase 8 only tracks it at the website
level), a backfill/reprocessing tool for historical events, a
recovery/reconciliation worker for events that failed to enqueue, a
distributed (multi-instance-safe) rate limiter (the current one is
in-memory/per-process — documented in
`docs/PRODUCTION_INTEGRATION_GUIDE.md` §10), and platform-specific
integrations (a dedicated Shopify app, WordPress plugin, etc. — the
universal SDK already works unmodified on those platforms today; a
purpose-built wrapper would be future, optional convenience, not a
missing capability).
