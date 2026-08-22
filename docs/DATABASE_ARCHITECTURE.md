# Database Architecture

This document describes the data model for the Universal Ecommerce Analytics
SaaS backend. `User` (Phase 2), `Website` (Phase 3), `Event` (Phase 4),
`Visitor`/`Session` (Phase 5), `Product`/`Cart`/`CartItem`/`Checkout`/
`Order`/`OrderItem` (Phase 6), and the analytics aggregation collections —
`AnalyticsBucket`, `ProductAnalyticsBucket`, `AnalyticsVisitorBucket`,
`AnalyticsSessionBucket`, `AnalyticsEventProcessed` (Phase 8) — are all
implemented. `Event` carries both the raw client-supplied
`anonymousId`/`sessionId` strings AND resolved `visitorId`/`sessionObjectId`
references — see "Phase 5" below for why both exist — plus, as of Phase 7,
a small set of processing-state fields (`processingStatus`,
`processingAttempts`, `lastProcessingAttemptAt`, `processedAt`,
`lastProcessingError`) that track asynchronous Visitor/Session/Commerce
processing separately from event acceptance. This document stays focused
on what each collection means; **how** an event moves from "accepted" to
"processed" is `docs/QUEUE_ARCHITECTURE.md`, and **how** processed events
become pre-aggregated statistics is `docs/ANALYTICS_ARCHITECTURE.md`.

## Entity Relationship Overview

```
User
 │
 └── Website
       │
       ├── Visitor
       │      ├── Session
       │      │      └── Event
       │      ├── Cart
       │      ├── Checkout
       │      └── Order
       │
       ├── Product
       │      ├── CartItem
       │      └── OrderItem
       │
       ├── Cart
       │      └── CartItem
       │
       ├── Checkout
       │
       ├── Order
       │      └── OrderItem
       │
       └── Analytics (Phase 8 — see docs/ANALYTICS_ARCHITECTURE.md)
              ├── AnalyticsBucket
              ├── ProductAnalyticsBucket
              ├── AnalyticsVisitorBucket
              ├── AnalyticsSessionBucket
              ├── AnalyticsEventProcessed
              └── FunnelAnalytics (planned)
```

- **User** owns one or more **Website** records (a tenant's account).
- **Website** is the root of all tenant-scoped data — every collection
  below it carries `websiteId`, and every repository query scopes by it
  (§28, enforced identically for the Phase 6 commerce collections).
- **Visitor** records a pseudonymous visitor to a website, identified by
  `websiteId + anonymousId` only — never IP/email/phone/fingerprint.
  Implemented in Phase 5.
- **Session** groups a visitor's activity into a bounded time window
  (inactivity-timeout based, not a fixed duration). Implemented in Phase 5.
- **Event** captures individual tracked actions. Implemented in Phase 4;
  linked to Visitor/Session in Phase 5. The nesting shown above is
  conceptual, not a hard requirement anywhere in this diagram: an Event (or
  a Cart, Checkout, or Order) can exist with no Visitor/Session attached at
  all when the client sends no `anonymousId` — see each entity's own
  section below for its exact "what if the identifier is missing" behavior.
- **Product** is a normalized, upserted-from-events catalog entry — there
  is no separate product sync API. Implemented in Phase 6.
- **Cart** / **CartItem** represent the current, incrementally-maintained
  state of an observed cart. Implemented in Phase 6.
- **Checkout** represents an observed checkout process, optionally linked
  to the Cart it came from. Implemented in Phase 6.
- **Order** / **OrderItem** represent a completed (or in-progress) purchase
  — OrderItem is a purchase-time snapshot, not a live view of Product.
  Implemented in Phase 6.
- **AnalyticsBucket** / **ProductAnalyticsBucket** /
  **AnalyticsVisitorBucket** / **AnalyticsSessionBucket** /
  **AnalyticsEventProcessed** are the pre-aggregated/rollup collections
  computed from successfully processed Events, Visitors/Sessions, and
  Orders. Implemented in Phase 8 — see `docs/ANALYTICS_ARCHITECTURE.md`
  for the full aggregation model. **FunnelAnalytics** remains planned for
  a future reporting-layer phase.

## Multi-Tenant Isolation Strategy

This is a multi-tenant SaaS system. A single MongoDB deployment holds data for
many tenants (users), each of whom may own multiple websites.

**Rule:** every website-scoped collection (`Visitor`, `Session`, `Event`,
`Product`, `Order`, `DailyAnalytics`, `ProductAnalytics`, `FunnelAnalytics`)
MUST carry a `websiteId` field referencing the owning `Website` document.

Example ownership scenario:

```
User A
 ├── Website A
 └── Website B

User B
 └── Website C
```

Requirement: **User A must never be able to read, write, or aggregate data
belonging to Website C.** Isolation is enforced at the data-access layer by
always filtering queries on `websiteId`, and by verifying that the
requesting user owns the `websiteId` being accessed before any query
executes. No cross-tenant query may omit the `websiteId` filter.

**Implemented in Phase 3** (see below for the `Website` collection itself):
every owner-scoped `website.repository.js` method takes `ownerId` as a query
parameter, not a post-fetch check — e.g. `findOne({ _id, ownerId })` rather
than `findById(_id)` followed by an `if (website.ownerId !== ownerId)` in
application code. This means ownership can't be bypassed by a bug elsewhere
in the call chain; the database query itself cannot return another tenant's
document. **Phase 4's `Event` collection follows the same rule from a
different direction**: since the collector is public (no authenticated
owner making the request), isolation there means every event document
carries the `websiteId` it was submitted under, and every query that will
ever read events back (Phase 5+ dashboards) must filter on it — see below.
The same pattern will carry forward to `Visitor`, `Session`, `Product`,
`Order`, and the `*Analytics` collections in later phases.

## Phase 3: Website Management (Implemented)

### Public `websiteId` vs internal `_id`

Every `Website` document has two identifiers that must never be confused:

- `_id` — the internal MongoDB ObjectId. Used by the authenticated dashboard
  API (`GET /api/websites/:id`, etc.). Never exposed to the public tracking
  script.
- `websiteId` — a public, non-secret identifier (16 lowercase hex
  characters, `crypto.randomBytes(8).toString('hex')`), generated server-side
  and never derived from or convertible back to `_id`. This is what gets
  embedded in the tracking snippet (`data-website-id="..."`) and will be
  sent by the browser to the future `/api/collect` endpoint. It is safe to
  appear in public HTML — it identifies a website, it does not authenticate
  a request. Uniqueness is enforced by a unique index, with a pre-check +
  retry loop in `website.service.js` as a courtesy (the index is the actual
  guarantee).

### Domain normalization

`domain` is stored as a lowercase hostname only — no scheme, path, query
string, or port (`https://example.com/shop?x=1` → `example.com`). Full
details and the specific rule about NOT merging `www.example.com` with
`example.com` (they're treated as distinct domains, since a subdomain can be
a legitimately different property) are documented in
`src/utils/domain.js`.

### Website ownership: `ownerId`

`ownerId` references `User._id`. It is set exclusively from the
authenticated request's `req.user.id` in `website.controller.js` — the
client cannot set or influence it, regardless of what a request body
contains, because the create/update code paths only ever read the
allow-listed validator output, never raw `req.body`.

### Lifecycle: `active` → `paused` → `archived`

`archived` is a one-way transition reached only through
`DELETE /api/websites/:id` (soft-delete: sets `status: 'archived'`, never a
physical row delete — future analytics collections will reference a website
by its `_id`, so hard-deleting it would orphan that history). Once archived:

- The website record itself is preserved indefinitely.
- `PATCH` on an archived website is rejected (`409 WEBSITE_ARCHIVED`) — it's
  a frozen historical record from that point on.
- Re-archiving is idempotent (no error).
- When `/api/collect` is implemented (Phase 4), it must check
  `website.status === 'active'` before accepting an event, so an archived
  (or paused) website's public `websiteId` cannot be used to inject new
  tracking data even though the identifier itself remains valid and public.

## Phase 4: Event Collection (Implemented)

### Public ingestion, not authenticated access

`POST /api/collect` identifies the *website* via the public `websiteId` in
the request body — the same identifier documented above, never the
dashboard JWT. This is deliberate: the caller is a tracking snippet running
on a customer's own website (React, WordPress, Shopify, plain HTML, an app
built next year in a framework that doesn't exist yet — the collector
doesn't know or care), not an authenticated dashboard user. `websiteId` is
public and non-secret by design; it identifies which tenant an event
belongs to, it does not authenticate the request. Abuse resistance instead
comes from strict payload validation, a body size cap (32KB), and a
rate-limit middleware boundary (see `src/middleware/rateLimiter.js` — an
in-memory, single-process, explicitly non-production-grade placeholder for
now).

### Idempotency: `websiteId` + `eventId`

Browsers retry. Networks duplicate. The identity of "have we already
recorded this event?" is the pair `(websiteId, eventId)`, enforced by a
unique compound index — the actual guarantee — with a pre-check in
`event.service.js` as a fast-path courtesy, and a duplicate-key catch
around the insert as a correctness fallback if two identical submissions
race each other. A client-supplied `eventId` is honored (and must be
1-128 chars of letters/digits/`-`/`_`); if omitted, the server generates a
`crypto.randomUUID()`. The same `eventId` on two *different* websites is
two different events — idempotency is scoped per website, not global.

### Timestamp semantics

Two distinct timestamps are stored on every event:

- `timestamp` — when the event actually occurred. Client-reported if
  present and plausible; defaults to `receivedAt` if the client omits it.
  Arbitrarily old values are accepted (an SDK may replay events queued
  while a device was offline); values more than ~5 minutes in the future
  are rejected outright (`INVALID_TIMESTAMP`) rather than trusted, since a
  client clock is never assumed correct.
- `receivedAt` — when *this server* accepted the request. Always
  server-set, never influenced by the client. The two are equal exactly
  when the client didn't supply a `timestamp`.

### Website status gating

Before any event is accepted, the collector resolves `websiteId` to a
`Website` and checks its `status`:

- `active` → accepted.
- `archived` → rejected (`403 WEBSITE_ARCHIVED`). An archived website is a
  frozen historical record (see Phase 3 above); it must not accumulate new
  data after the fact.
- `paused` → **rejected** (`403 WEBSITE_PAUSED`), not silently accepted.
  This was a deliberate choice between two options — reject outright, or
  accept-but-flag — in favor of the one with a single, unambiguous
  semantic everywhere downstream: "paused" always means "not currently
  tracking," full stop, rather than a second partially-tracked state every
  future consumer (dashboards, exports, analytics jobs) would need to
  remember to filter out.

### Privacy: an allow-list, not a pass-through

The event's ecommerce `data` is never the client's raw object. Each
`event` name has its own hand-written validator (`event.validator.js`)
that reads out only the specific fields that event type is defined to
have (e.g. `add_to_cart` reads `productId`/`price`/`quantity`/`name`/
`currency` and nothing else) and constructs a new object from them. A
client field that isn't on that list — `password`, `cvv`, `creditCard`,
or anything else — is never copied anywhere; there is no code path that
would persist it. The `Event` model's `data` sub-schema (a fixed set of
typed fields, not an open `Mixed` type) is a second, redundant layer of
the same protection. No raw IP address or geo-location is stored at all —
deferred until a later phase actually needs it, rather than carried as an
always-collected, currently-unused personal-data field.

### High-volume / queue readiness — implemented in Phase 7

This section originally described a *future* seam: "when ingestion volume
requires decoupling collection from persistence, a queue producer replaces
the direct `eventRepository.create()` path." Phase 7 is that phase — see
`docs/QUEUE_ARCHITECTURE.md` for the full design (ingestion vs. processing
split, BullMQ/Redis, retry policy, idempotency, graceful shutdown). In
short: `event.service.js` now only validates, persists the Event, and
enqueues a processing job; `eventProcessing.service.js` (invoked by a
separate worker process) does the Visitor/Session/Commerce work that used
to run inline. Exactly the seam this section originally pointed at, now in
place.

## Phase 5: Visitor & Session Resolution (Implemented)

### Identity, and why it stays pseudonymous

A `Visitor` is identified by **`websiteId + anonymousId` — nothing else.**
Never IP address, email, phone, password, or a browser fingerprint. The
same `anonymousId` on two different websites produces two independent
`Visitor` documents (a unique compound index on `{websiteId, anonymousId}`
is the actual guarantee); `anonymousId` is never treated as a global
cross-site identity. This is a deliberate privacy boundary, not an
oversight — the system is designed so it structurally cannot build a
cross-site profile of a person from this data, and cannot identify a real
person from it at all without information it never collects.

A `Session` is identified by **`websiteId + sessionId`**, also a unique
compound index, and always belongs to exactly one `Visitor`
(`Session.visitorId → Visitor._id`). Neither identifier is ever the
document's own MongoDB `_id` — same reasoning as `Website.websiteId` in
Phase 3: the browser-facing identity and the internal document id are
different things.

### Resolution pipeline (per accepted event)

```
POST /api/collect
   ↓ validate, validate website (Phase 4, unchanged)
   ↓ idempotency check (websiteId + eventId) — duplicates stop HERE
   ↓ resolve Visitor  (find by websiteId+anonymousId, or create)
   ↓ resolve Session  (find active by websiteId+sessionId, or create)
   ↓ persist Event (with visitorId/sessionObjectId attached)
   ↓ update Visitor counters   ┐ only reached for a genuinely
   ↓ update Session counters   ┘ new (non-duplicate) event
```

The idempotency check runs **before** any Visitor/Session work, not just
as an optimization but for correctness: if a stale retry of an old event
were resolved against current wall-clock time, it could find its own
session "expired" (because real time elapsed since the original request)
and incorrectly mint a brand-new session purely because it was
resubmitted. Short-circuiting on a duplicate means it never touches
Visitor/Session state at all — see `event.service.js`.

### Counters can never double-count a duplicate

Visitor/Session **resolution** (find-or-create) is idempotent by
construction — calling it again for the same identity finds the existing
document, never creates a second one. Visitor/Session **counter updates**
(`eventCount`, `sessionCount`, `pageViewCount`, etc.) are a separate step
that only runs after `eventRepository.create()` actually succeeds for a
brand-new event document. A duplicate (whether caught by the pre-check or
by losing a race on the unique `{websiteId, eventId}` index at insert
time) returns before ever reaching the counter-update code. This is the
same invariant Phase 4 idempotency already relied on, just extended to
cover two more collections instead of one.

### Session timeout

Configurable via `SESSION_TIMEOUT_MINUTES` (default 30,
`src/config/env.js`), never hard-coded. On each event with a
client-supplied `sessionId`: if a matching session exists and
`now - lastActivityAt` is under the timeout, it's reused; otherwise a new
session is created and the old one's `endedAt` is set to its last known
activity time. No background sweep is needed — expiry is only ever
evaluated lazily, at the moment the next event for that identity arrives
(Phase 5 §18 explicitly does not require a worker for this).

**Why an expired continuation gets a *different* sessionId.** The unique
index on `{websiteId, sessionId}` means a given sessionId string is
permanently tied to one document, forever — even after that session ends.
So when a client's sessionId is found but expired, the new session that
continues it cannot reuse that exact string; `session.service.js`
generates a fresh one (`crypto.randomUUID()`) for it instead. The
`Event.sessionId` field still records exactly what the client sent
(unmodified, for data fidelity), while `Event.sessionObjectId` points at
whichever session document the event actually landed in — these two can
legitimately diverge in this one scenario, which is the whole reason both
fields exist on `Event` (see the Event section above). A future SDK that
locally tracks its own session expiry and rotates its sessionId before
this situation arises will rarely trigger this path in practice; it exists
so the backend is still correct when that SDK doesn't exist yet, or
misbehaves.

### Missing `anonymousId` / `sessionId`

- **No `anonymousId`:** the event is still accepted (unchanged from Phase
  4) but is treated as unidentifiable — no `Visitor` and, since a session
  cannot exist without an owning visitor, no `Session` are created or
  touched. The backend never fabricates an `anonymousId` from IP,
  user-agent, or anything else to work around this.
- **`anonymousId` present, no `sessionId`:** a `Visitor` is resolved
  normally. Since there's no client-supplied string to look a session up
  by, the backend generates one (`crypto.randomUUID()`) and creates a
  fresh session for that single event. Two such events — even from the
  same visitor, seconds apart — get two separate sessions, because nothing
  in the request correlates them. This is an intentional, documented
  consequence of the client not persisting a sessionId, not a bug: the SDK
  is expected to generate and persist `sessionId` itself for meaningful
  session grouping (Phase 5 §21).

### Concurrency

Two near-simultaneous first events for the same brand-new `anonymousId`
(or `sessionId`) both attempt to create a document; the unique index
allows exactly one `insertOne` to succeed, and the loser catches the
duplicate-key error and re-fetches the winner's document rather than
retrying the insert or erroring out. Same pattern Phase 3 already uses for
`Website.websiteId` collisions, applied here to two more identities. No
transaction is used for this — a single unique-index-protected insert plus
a catch-and-refetch is sufficient and cheaper than a multi-document
transaction for what is, in the failure case, a single retried write.

## Phase 6: Normalized Ecommerce Data (Implemented)

### Architectural principle: normalize, don't mirror

A Django store, a Shopify store, a WooCommerce store, and a hand-rolled
React storefront all have completely different internal schemas. This
system does not try to represent any of them. It defines one universal
event contract (§23 below) and normalizes whatever arrives into its own
six commerce entities: `Product`, `Cart`/`CartItem`, `Checkout`,
`Order`/`OrderItem`. The event system (Phase 4/5) remains the only
ingestion path — Phase 6 adds no new public endpoint; these entities are
populated entirely as a side effect of `POST /api/collect`.

### External id strategy

Every commerce entity's business identity is a **customer-supplied
string** — `externalProductId`, `externalOrderId`, `cartId`, `checkoutId`
— never assumed numeric (a Shopify id, a WooCommerce id, a Django UUID, or
a plain SKU are all just strings here), capped at 200 characters, and
never equal to or derived from our own MongoDB `_id`. This is the same
principle Phase 3 established for `Website.websiteId`, applied to four
more identities. Where an entity also needs to reference another one
internally (an `OrderItem.orderId` pointing at its `Order`, a
`CartItem.productId` pointing at its resolved `Product`), that's a
genuine ObjectId reference — the two kinds of "id" are never confused with
each other in a single field.

### Money precision strategy

Every monetary field on every Phase 6 entity (`Product.price`,
`Cart.subtotal`, `Order.total`, `OrderItem.unitPrice`, etc.) is stored as
an **integer in minor units** — never a JS floating-point number, and
never computed with one. `850.50` (major units, e.g. BDT) is converted
once, at the service boundary, to `85050` (minor units) via
`src/utils/money.js`, and only the integer ever reaches MongoDB.

This was a deliberate choice between two documented options (integer
minor units vs. MongoDB `Decimal128`); minor units won because it avoids
`Decimal128`'s serialization/comparison quirks in application code and
keeps every arithmetic operation (`$inc` on a cart subtotal, computing an
order line's subtotal) exact integer math.

**Documented simplification:** Phase 6 uses a fixed 2-decimal (×100)
convention for every currency, rather than each currency's true ISO 4217
minor-unit exponent (most are 2, but JPY is 0 and BHD is 3, for example).
This is correct for the large majority of currencies and a known,
accepted approximation for the few it isn't — a per-currency exponent
table is a natural follow-up once a specific affected currency is actually
in use, not a gap being hidden.

**What does NOT change:** `Event.data` (Phase 4/5) keeps storing whatever
raw major-unit number the client sent, unconverted — it's the historical
raw event record, and Phase 6 doesn't touch that design. The conversion to
minor units happens only when building the normalized entities.

### Product upsert

`Product` has no separate sync API — it's upserted from
`product_view`/`add_to_cart`/`checkout`/`purchase` events (§4), identified
by `websiteId + externalProductId` (unique index, same
find-then-create-with-duplicate-key-catch pattern as `Website`/`Visitor`).
An existing product's `name`/`price`/`currency` refresh with whatever a
later sighting provides (never blanked out by a sighting that simply
didn't mention them); `firstSeenAt` never changes after creation.

### Cart / CartItem behavior

`Cart` identity is `websiteId + cartId`; `CartItem` identity is
`websiteId + cartId + externalProductId` (unique — one line per product
per cart). Both `add_to_cart.quantity` and `remove_from_cart.quantity` are
**incremental** (documented choice, §24): "this many were just
added/removed," not an absolute new quantity. Repeated `add_to_cart` for
the same product accumulates; `remove_from_cart` decrements and clamps at
zero — a removal that would go negative instead deletes the `CartItem`
entirely. `Cart.itemCount`/`subtotal` are maintained incrementally
(`$inc` alongside each `CartItem` change) rather than recomputed by
summing `CartItem`s on every event, per §36's ban on expensive ingestion-
time queries. Accepted tradeoff: under a pathological concurrent-request
interleaving, these aggregates could in principle drift slightly from the
true sum of `CartItem`s — a known limitation of the lightweight design,
not something Phase 6 attempts to close with transactions (§28 permits
this: the hard requirement is no double-counting per duplicate *event*,
which idempotency already guarantees, not perfect aggregate consistency
under every possible race).

### Checkout behavior

`Checkout` identity is `websiteId + checkoutId`. A `checkout` event
creates or refreshes one with `status: 'started'`, optionally linked to
`cartId` and to the visitor/session already resolved earlier in the same
event pipeline (Phase 5). A later `purchase` event that supplies a
matching `checkoutId` transitions it to `'completed'` — and **only** then
(§25): a purchase with a missing or unrelated `checkoutId` never marks any
checkout completed, and never fabricates one. `'abandoned'` is a valid,
defined status value that nothing in Phase 6 ever sets — detecting
abandonment requires evaluating elapsed time against no new activity,
which needs a worker or scheduled sweep, both explicitly out of scope
here (§37). A future phase adds that; the field is ready for it.

### Order idempotency: websiteId + externalOrderId

This is a **separate** idempotency guarantee from Phase 4/5's
`websiteId + eventId` event-level idempotency, and genuinely necessary on
top of it: two *different* events (different `eventId`s — a client retry
that regenerated its id, or two distinct webhook deliveries for the same
order) can carry the same `externalOrderId`, and event-level idempotency
has no way to catch that, since it only ever sees one of them as "new."

Order upsert is a real upsert, not a strict reject-duplicate: an order's
`paymentStatus` and financial fields are expected to evolve across
multiple purchase events over its lifecycle (e.g. pending → paid), so a
second event for a known `externalOrderId` updates the existing document.
What never happens twice is the **document itself** (the unique index +
pre-check + duplicate-key-catch, same pattern as everywhere else in this
system) or its **`OrderItem`s** — those are created exactly once, only on
the branch where the `Order` was just newly created, never on the update
branch. This is what makes "duplicate purchase does not duplicate
order/items" (§34) hold even for the two-different-events case that
event-level idempotency alone can't catch.

### Order total validation policy

When a client supplies a **full** breakdown — `subtotal`, `discount`,
`shipping`, `tax`, AND `total` all together — the relationship
`subtotal - discount + shipping + tax = total` is checked (±0.01 to
absorb ordinary rounding) and the event is rejected
(`INVALID_EVENT_DATA`) if it doesn't hold (§18). A **partial** breakdown
(e.g. just `discount` alone) is accepted without cross-checking — there's
nothing reliable to validate it against. When no explicit `total` is
sent, it defaults to the original Phase 4 field it's replacing/extending
(`cartValue` for checkout, `revenue` for purchase) — they represent the
same concept, so no data is lost by the extension.

### Revenue semantics (defined, not calculated)

`Order.total` is the canonical gross order amount. `subtotal`,
`discount`, `shipping`, `tax`, and `refundedAmount` are stored as
independent, defined fields — Phase 6 itself does not compute gross
revenue, net revenue, refunds, or average order value from them. Phase 8
is the phase that does: it aggregates `Order.total`/`refundedAmount` into
`AnalyticsBucket.grossRevenueMinor`/`refundedAmountMinor`/`netRevenueMinor`
(see `docs/ANALYTICS_ARCHITECTURE.md` §9) — but even Phase 8 stores only
raw counts and sums, never a derived rate or average; AOV and conversion
rates are computed from those stored counters at reporting time, not
persisted anywhere (§12 of that document).

### Privacy

No IP address, browser fingerprint, payment card number, CVV, password,
or authentication token is ever a field on any Phase 6 entity — not
"stripped before saving," structurally absent from every schema, the same
allow-list principle Phase 4 established for `Event.data` applied here:
each commerce data validator reads out only its own named fields, so an
unrecognized key (however sensitive) is never read, and therefore never
reaches any document (verified directly in `tests/commerce.security.test.js`).
There is no customer-profile system here — `Order`/`Checkout`/`Cart`
reference a pseudonymous `Visitor` (§30, same identity rules as Phase 5),
never a name, email, or phone number.

## Phase 8: Analytics Aggregation (Implemented)

Five collections turn successfully processed `Event`s into pre-aggregated,
query-efficient statistics — see `docs/ANALYTICS_ARCHITECTURE.md` for the
full aggregation flow, idempotency model, and metric-by-metric mapping.
Summarized here for the entity catalog:

- **`AnalyticsBucket`** — website-level rollup (page/product/cart/checkout/
  order/revenue counters) for one `{websiteId, granularity, bucket}`.
- **`ProductAnalyticsBucket`** — the same shape of rollup, per product
  (`{websiteId, productId, granularity, bucket}`), kept in its own
  collection specifically so a website with a large catalog never bloats
  the website-level document.
- **`AnalyticsVisitorBucket`** / **`AnalyticsSessionBucket`** — small
  "claim" documents (`{websiteId, granularity, bucket, anonymousId}` /
  `{..., sessionId}`) that make `uniqueVisitors`/`uniqueSessions` counting
  safe under concurrency without ever storing an unbounded array of IDs.
- **`AnalyticsEventProcessed`** — the analytics-layer idempotency marker
  (`{websiteId, eventId}`), separate from `Event.processingStatus` — see
  `docs/ANALYTICS_ARCHITECTURE.md` §13 for why aggregation needs its own.

All five follow the same money/timestamp conventions as every other
collection here: monetary fields are integer minor units
(`src/utils/money.js`), and `bucket` is always a UTC `Date`, never a
locally-timezoned one.

## Planned Collections (Future Phases)

| Collection        | Scope             | Owning Reference        | Status        |
|--------------------|-------------------|--------------------------|---------------|
| User               | account           | —                        | Implemented (Phase 2) |
| Website            | tenant root       | `ownerId`                | Implemented (Phase 3) |
| Event              | website-scoped    | `websiteId`              | Implemented (Phase 4) |
| Visitor            | website-scoped    | `websiteId`              | Implemented (Phase 5) |
| Session            | website-scoped    | `websiteId`, `visitorId` | Implemented (Phase 5) |
| Product            | website-scoped    | `websiteId`              | Implemented (Phase 6) |
| Cart               | website-scoped    | `websiteId`, `visitorId` | Implemented (Phase 6) |
| CartItem           | website-scoped    | `websiteId`, `cartId`    | Implemented (Phase 6) |
| Checkout           | website-scoped    | `websiteId`, `visitorId` | Implemented (Phase 6) |
| Order              | website-scoped    | `websiteId`, `visitorId` | Implemented (Phase 6) |
| OrderItem          | website-scoped    | `websiteId`, `orderId`   | Implemented (Phase 6) |
| AnalyticsBucket        | website-scoped    | `websiteId`              | Implemented (Phase 8) |
| ProductAnalyticsBucket | website-scoped    | `websiteId`, `productId` | Implemented (Phase 8) |
| AnalyticsVisitorBucket | website-scoped    | `websiteId`              | Implemented (Phase 8) |
| AnalyticsSessionBucket | website-scoped    | `websiteId`              | Implemented (Phase 8) |
| AnalyticsEventProcessed| website-scoped    | `websiteId`              | Implemented (Phase 8) |
| FunnelAnalytics     | website-scoped    | `websiteId`              | Planned (reporting-layer phase) |

## Index Strategy

### Implemented (`Website`, Phase 3)

- `{ websiteId: 1 }` unique — the actual uniqueness guarantee for the public
  tracking id (application code also pre-checks before insert, but this
  index is what makes it correct under concurrent creates).
- `{ ownerId: 1, createdAt: -1 }` — supports `GET /api/websites` (list the
  caller's websites, newest first).
- `{ ownerId: 1, status: 1 }` — supports filtering a user's websites by
  status (e.g. hiding archived ones), reserved for when the list endpoint
  grows a status filter.
- `{ domain: 1 }` — non-unique. Supports a future domain-based lookup (e.g.
  "does this domain already have a tracking website?"); not unique because
  Phase 3 does not require cross-tenant or cross-website domain uniqueness.
- `{ _id, ownerId }` queries (`findByIdAndOwner`, `updateByIdAndOwner`,
  `archiveByIdAndOwner`) are satisfied by the default `_id` index plus the
  in-memory `ownerId` equality check MongoDB performs on the matched
  document — no additional compound index is needed since `_id` alone is
  already unique and highly selective.

### Implemented (`Event`, Phase 4)

- `{ websiteId: 1, eventId: 1 }` unique — the idempotency guarantee
  (§ Phase 4 above). The application-level pre-check and duplicate-key
  catch make this correct under concurrent duplicate submissions; the
  index is what makes it correct at all.
- `{ websiteId: 1, timestamp: -1 }` — supports a future "recent events for
  this website" query (Phase 5+ debugging/dashboard use); not queried by
  the collector itself.
- `{ websiteId: 1, eventName: 1, timestamp: -1 }` — supports a future
  "all purchases for this website" style query, same caveat.
- `{ processingStatus: 1, receivedAt: 1 }` (Phase 7) — deliberately NOT
  website-scoped, unlike every other index here: this is an operational
  index for a future reconciliation tool scanning across all tenants for
  stuck `pending`/`failed` events, not a tenant data-access pattern. See
  `docs/QUEUE_ARCHITECTURE.md`.

Deliberately no index on `eventName` alone, `anonymousId`, `sessionId`,
`visitorId`, or `sessionObjectId`: nothing queries by those in isolation
yet, and an unused index only costs write throughput on a collection built
for high-volume ingestion. Add one when a real query pattern needs it
(e.g. a Phase 6+ "all events for this session" dashboard view).

### Implemented (`Visitor`/`Session`, Phase 5)

- `Visitor { websiteId: 1, anonymousId: 1 }` unique — the visitor identity
  guarantee (§ Phase 5 above); same pre-check + duplicate-key-catch pattern
  as `Website.websiteId`.
- `Visitor { websiteId: 1, lastSeenAt: -1 }` / `{ websiteId: 1, createdAt: -1 }`
  — reserved for future "recently active visitors" / "newest visitors"
  dashboard queries; not queried by the collector itself.
- `Session { websiteId: 1, sessionId: 1 }` unique — the session identity
  guarantee, and what makes an expired sessionId permanently unreusable
  (§ Phase 5 above).
- `Session { websiteId: 1, anonymousId: 1, lastActivityAt: -1 }` — supports
  "this visitor's sessions, most recent first" (future dashboard use).
- `Session { websiteId: 1, startedAt: -1 }` — supports "recent sessions for
  this website" (future dashboard use).

No index on `Session.visitorId` alone: every current lookup goes through
`{websiteId, sessionId}` or `{websiteId, anonymousId, ...}`, both of which
already have covering indexes above.

### Implemented (Phase 6 commerce entities)

- `Product { websiteId: 1, externalProductId: 1 }` unique — the product
  identity/upsert guarantee (§3/§4).
- `Cart { websiteId: 1, cartId: 1 }` unique — the cart identity guarantee
  (§7).
- `CartItem { websiteId: 1, cartId: 1, externalProductId: 1 }` unique —
  prevents a duplicate line item for the same product in the same cart
  (§8); this is what add_to_cart's "increment, don't duplicate" logic
  relies on.
- `Checkout { websiteId: 1, checkoutId: 1 }` unique — the checkout identity
  guarantee (§9).
- `Order { websiteId: 1, externalOrderId: 1 }` unique — the order
  identity/idempotency guarantee (§5/§12) — the single most important
  index in this phase; see "Order idempotency" above.
- `Order { websiteId: 1, purchasedAt: -1 }` — reserved for future
  revenue-report queries (explicitly not implemented this phase); not
  queried by the event pipeline itself.
- `OrderItem { websiteId: 1, orderId: 1, externalProductId: 1 }` —
  **not unique**, deliberately (§31 lists this one without the "→ unique"
  suffix every sibling index has): an order can legitimately carry more
  than one line for the same externalProductId (e.g. distinct variants
  tracked under one base product id by some platform). Exists for query
  efficiency ("this order's line items"), not as an identity constraint.

No index on `Cart.visitorId`, `Checkout.visitorId`, or `Order.visitorId`
alone: nothing in Phase 6 queries by those in isolation yet (add one when
a future dashboard actually needs "this visitor's orders" as a direct
lookup rather than going through `{websiteId, externalOrderId}`).

### Implemented (Phase 8 analytics aggregation)

- `AnalyticsBucket { websiteId: 1, granularity: 1, bucket: 1 }` unique —
  the bucket identity; every aggregation write and future reporting read
  goes through this.
- `ProductAnalyticsBucket { websiteId: 1, productId: 1, granularity: 1,
  bucket: 1 }` unique — the per-product bucket identity.
- `AnalyticsVisitorBucket { websiteId: 1, granularity: 1, bucket: 1,
  anonymousId: 1 }` unique — the unique-visitor claim; see
  `docs/ANALYTICS_ARCHITECTURE.md` §8.
- `AnalyticsSessionBucket { websiteId: 1, granularity: 1, bucket: 1,
  sessionId: 1 }` unique — the unique-session claim, same pattern.
- `AnalyticsEventProcessed { websiteId: 1, eventId: 1 }` unique — the
  analytics idempotency claim; see `docs/ANALYTICS_ARCHITECTURE.md` §13.

### Planned (future phases)

These indexes are **not yet created** — they document intent for a future
reporting-layer phase.

- `FunnelAnalytics`: compound index on `{ websiteId, funnelId, date }`.

Every compound index leads with `websiteId` so tenant-scoped queries can use
the index prefix, and to keep cross-tenant scans impossible by construction.

## Shared Schema Conventions

All future models will use the shared options defined in
`src/models/baseSchemaOptions.js`:

- `timestamps: true` — automatic `createdAt` / `updatedAt`.
- `versionKey: false` — no `__v` field in API responses.
- A `toJSON` transform that renames `_id` to `id` and strips internal fields.

This keeps every collection's serialized shape consistent without repeating
boilerplate in each model file.
