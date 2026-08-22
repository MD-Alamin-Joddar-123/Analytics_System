# Analytics Aggregation Architecture (Phase 8)

This document describes how a successfully processed `Event` becomes
pre-aggregated analytics statistics, and the consistency/idempotency/
multi-tenancy guarantees that aggregation is built on. It complements
`docs/QUEUE_ARCHITECTURE.md` (how an event gets processed at all) and
`docs/DATABASE_ARCHITECTURE.md` (what each entity means) — this document
covers what happens to a processed event's *numbers*.

Phase 8 is internal infrastructure only. There is no public reporting API,
no dashboard, and no `GET /analytics` endpoint — see "Scope" at the end of
this document.

## 1. Where this fits

```
Client
  │
  ▼
POST /api/collect  (Phase 4/7 — ingestion only, unchanged)
  │
  ▼
Event (processingStatus: 'pending')
  │
  ▼
Redis Queue (Phase 7 — unchanged)
  │
  ▼
Worker
  │
  ▼
eventProcessing.service.js
  ├─ resolveVisitor / resolveSession        (Phase 5, unchanged)
  ├─ processCommerceEvent                   (Phase 6, unchanged logic —
  │                                           now also RETURNS a descriptor
  │                                           of what it resolved, §7 below)
  └─ analyticsAggregationService.aggregateEvent   ◄── Phase 8, THIS document
       │
       ▼
     AnalyticsBucket / ProductAnalyticsBucket
     AnalyticsVisitorBucket / AnalyticsSessionBucket
     AnalyticsEventProcessed (idempotency marker)
```

Analytics aggregation is a **required** step in processing, not an optional
side effect: `eventProcessing.service.js` calls it after commerce
resolution and *before* marking the Event `completed`. If aggregation
throws, the Event is marked `failed` and BullMQ retries the whole attempt —
exactly like a Visitor/Session/Commerce failure already does. An Event can
never be `completed` with its analytics silently skipped.

## 2. The eligibility rule

**Only `Event.processingStatus === 'completed'` events contribute to
analytics — and more precisely, only events that make it through the
*entire* worker pipeline successfully, since aggregation itself runs
*before* that status is set.** An event that fails Visitor/Session
resolution never reaches aggregation at all. An event where aggregation
itself fails is retried, not silently dropped and not counted. There is no
code path that increments an analytics counter for an event that hasn't
(yet) fully succeeded.

## 3. Aggregation collections

Five purpose-built collections (`src/models/`), not one collection per
metric (§6) and not a single collection trying to do everything:

| Model | Purpose | Identity |
|---|---|---|
| `AnalyticsBucket` | Website-level rollup — every core metric except per-product breakdowns | `websiteId + granularity + bucket` (unique) |
| `ProductAnalyticsBucket` | Per-product rollup | `websiteId + productId + granularity + bucket` (unique) |
| `AnalyticsVisitorBucket` | Uniqueness marker: "this visitor already counted in this bucket" | `websiteId + granularity + bucket + anonymousId` (unique) |
| `AnalyticsSessionBucket` | Uniqueness marker: "this session already counted in this bucket" | `websiteId + granularity + bucket + sessionId` (unique) |
| `AnalyticsEventProcessed` | Idempotency claim: "this event's analytics have been applied" | `websiteId + eventId` (unique) |

Every model carries `websiteId` and every index above leads with it (§4/§34
— see "Multi-tenant isolation" below).

## 4. Multi-tenant isolation

Every read and write in this layer is scoped by `websiteId` — it's the
leading field in every compound index above, and every repository method
takes it as an explicit parameter (never inferred, never optional). Two
websites sharing the same `externalProductId` (a very real scenario — two
merchants both naming a SKU `"123"`) produce two completely independent
`ProductAnalyticsBucket` documents, keyed apart by `websiteId` before
`productId` is even considered. `tests/analyticsAggregation.service.test.js`
and `tests/analyticsEndToEnd.test.js` both include dedicated cross-website
isolation tests, including the shared-product-id case.

## 5. Time buckets — UTC, hour + day, extensible

Every bucket document's `bucket` field is a **UTC-truncated `Date`** — the
start of that hour or day, always in UTC, never in a website's configured
local timezone (`docs/DATABASE_ARCHITECTURE.md` already documents
`Website.timezone` as a *presentation* concern; Phase 8 does not touch it).
Applying a website's timezone to these buckets is entirely a future
reporting-layer concern.

`granularity` is one of `SUPPORTED_GRANULARITIES` (`src/constants/
analyticsGranularity.js`, currently `['hour', 'day']`). Every model, every
repository method, and every aggregation call is granularity-agnostic —
none of them hard-code "hour" or "day" as special cases. Adding `'week'` or
`'month'` later means:

1. Add the value to `SUPPORTED_GRANULARITIES`.
2. Add one bucket-truncation function to `getBucket()` in
   `analyticsBucket.service.js`.

Nothing else changes — not the models, not the unique indexes' shape, not
the idempotency/uniqueness strategy, not the aggregation orchestration.

**Late events (§31)**: the bucket is derived from `Event.timestamp` — the
client-reported/effective event time — never from `Event.receivedAt`. An
event that occurred at 14:58 but was only processed at 15:03 (queue
backlog, retry backoff, whatever the cause) still lands in the 14:00 hour
bucket, exactly as if it had been processed instantly. `receivedAt`
reflects server/queue timing noise, not anything about when the visitor
actually acted, so it is never used for bucketing. This also means
aggregation is **deterministic**: re-running it for the same event, at any
later time, produces the exact same bucket — the property a future
backfill/reprocessing job (§32, not built this phase) depends on.

## 6. Event → metric mapping (centralized, pure, testable)

`src/constants/analyticsMetrics.js` exports two pure functions —
`mapEventToBucketIncrements(eventName, commerce)` and
`mapEventToProductOperations(eventName, commerce)` — that are the **single
source of truth** for "what does this event mean for analytics." No event
name strings are scattered elsewhere; `analyticsAggregation.service.js` is
their only caller. Both are plain data-in/data-out functions: no I/O, no
Express `req`/`res`, no database access — fully covered by
`tests/analyticsMetrics.test.js` without any mocking at all.

| Event | Website-level counters | Product-level counters |
|---|---|---|
| `page_view` | `pageViews` | — |
| `product_view` | `productViews` | `productViews` |
| `add_to_cart` | `addToCarts`, and if new: `cartsCreated`; if a product resolved: `cartItems`, `cartQuantity`, `cartValueMinor` | `addToCarts` |
| `remove_from_cart` | `removeFromCarts` | `removeFromCarts` |
| `checkout` | `checkoutStarted` — **only if this is a brand-new Checkout** | — |
| `purchase` | `orders`, `unitsSold`, `grossRevenueMinor`, `refundedAmountMinor`, `netRevenueMinor` — **only if this is a brand-new Order**; `checkoutCompleted` — **only on the event that actually transitions the linked checkout** | per order line: `unitsSold`, `orders`, `revenueMinor` |

`uniqueVisitors`/`uniqueSessions` are handled separately from this mapping
(§8, below) since they depend on cross-event state (has this visitor been
seen in this bucket before), not just the current event in isolation.

## 7. The commerce descriptor — reusing Phase 6 decisions, never re-deriving them

`processCommerceEvent()` (`eventProcessing.service.js`) already resolves
every commerce entity for the worker's Phase 5/6 dispatch. Phase 8 does
**not** re-query or re-derive any of that. Instead, `processCommerceEvent`
now *returns* a descriptor of exactly what it did:

```js
{
  product,               // resolved Product doc, or null
  externalProductId,      // raw productId string (remove_from_cart only)
  cart, isNewCart, cartItemChange,   // { quantity, unitPriceMinor } or null
  checkout, isNewCheckout, checkoutJustCompleted,
  order, isNewOrder, orderItems,     // the created OrderItem docs (§9 below)
}
```

Every `isNew*`/`*JustCompleted` flag here is the *exact same decision*
`cartService`/`checkoutService`/`orderService` already made while resolving
the entity — Phase 8 threads it through their return values rather than
re-checking "does this already exist" a second time. This is the concrete
mechanism behind §9/§17/§18's "no second idempotency system" requirement.

## 8. Unique visitors / unique sessions — no unbounded arrays

`uniqueVisitors`/`uniqueSessions` are **not** computed by incrementing on
every event, and **not** stored as an array of IDs on the bucket document
(which would grow without bound under real traffic — explicitly ruled out
by §12). Instead, two small "claim" collections exist purely to answer
"have I already counted this visitor/session in this bucket":

```
AnalyticsVisitorBucket { websiteId, granularity, bucket, anonymousId }
  unique index: websiteId + granularity + bucket + anonymousId

AnalyticsSessionBucket { websiteId, granularity, bucket, sessionId }
  unique index: websiteId + granularity + bucket + sessionId
```

For each event, for each granularity: attempt to `create()` a claim
document. Success (no duplicate-key error) means this is the *first* time
this visitor/session has been seen in this specific bucket — increment
`uniqueVisitors`/`uniqueSessions` on the matching `AnalyticsBucket`. A
duplicate-key error means some earlier event already claimed it — do
nothing, safely and atomically, even under concurrent workers (§23,
verified directly in `tests/analyticsAggregation.service.test.js`, which
fires 100 concurrent events from one visitor and asserts `uniqueVisitors`
lands at exactly 1).

`uniqueSessions` keys on the *resolved* session's `sessionId` when a
session was resolved, falling back to the raw `event.sessionId` when it
wasn't (mirrors how `Order`/`Cart`/`Checkout` already store session
identity — see `docs/DATABASE_ARCHITECTURE.md`).

## 9. Revenue — from normalized Order data, never recomputed

`grossRevenueMinor` comes from `Order.total` — the same normalized,
already-validated integer-minor-units field `docs/DATABASE_ARCHITECTURE.md`
documents as the canonical gross amount. Phase 8 never recalculates
revenue from a client-supplied event field when a normalized `Order`
already exists (§13). Per-product `revenueMinor` comes from the created
`OrderItem.total` (falling back to `.subtotal`) — the exact same
purchase-time snapshot values `order.service.js`'s `createOrderItems()`
already computed, not a second computation.

`refundedAmountMinor` reads `Order.refundedAmount` generically. **Under
every event Phase 6 currently supports, this is always `0`** — there is no
refund event, so no code path ever sets it to anything else. The field is
read this way (not hard-coded to `0`) so that if/when a future phase adds
refund support, analytics starts reflecting it without a mapping change
here — but Phase 8 does not invent refund behavior Phase 6 doesn't have
(§13/§36).

```
netRevenueMinor = grossRevenueMinor - refundedAmountMinor
```

computed once per purchase event, from two integers, and stored as an
integer — never accumulated as a float.

**Order idempotency (§9)**: a duplicate purchase event for an
`externalOrderId` already recorded — whether a client retry with a new
`eventId`, or literally the same event redelivered by BullMQ — carries
`isNewOrder: false` on the commerce descriptor (from `order.service.js`'s
existing `{ websiteId, externalOrderId }` unique-index-backed upsert). The
metric mapping gates every order-related counter on `isNewOrder`, so
`orders`/`unitsSold`/revenue never move a second time for the same order.
Verified directly (two different `eventId`s, same `externalOrderId`,
asserted `orders === 1`) in
`tests/analyticsAggregation.service.test.js`.

## 10. Cart metrics — activity volume, not live state, never revenue

`cartsCreated`, `cartItems`, `cartQuantity`, `cartValueMinor` measure
**cumulative add-to-cart activity observed within one bucket** — not the
live, current state of any cart. The normalized `Cart`/`CartItem` entities
from Phase 6 remain the sole source of truth for "what's actually in this
cart right now." This is a deliberate scope boundary, not an oversight:

- These counters are **never decremented** by `remove_from_cart` (which
  has its own separate `removeFromCarts` counter). A bucket's
  `cartQuantity` can never go negative, and doesn't need to reconcile
  against removals that might land in a different bucket window.
- `cartValueMinor` is explicitly **not** a revenue field, and is never
  combined with `grossRevenueMinor`/`netRevenueMinor` in any calculation
  (§17). `tests/analyticsAggregation.service.test.js` has a dedicated test
  asserting the two stay independent even within the same bucket
  (add-to-cart followed by an unrelated purchase in the same hour).

## 11. Checkout metrics — duplicate-safe

`checkoutStarted` increments only when `checkoutService.upsertCheckout`
reports `isNew: true` — a second `checkout` event for an already-known
`checkoutId` (a client resending, or a resumed checkout flow) does not
increment it again. `checkoutCompleted` increments only on the specific
`purchase` event that actually transitions the linked checkout's status
from `started` to `completed` (`checkoutService.completeCheckoutIfLinked`'s
`justCompleted` flag) — a duplicate purchase webhook referencing an
already-completed checkout reports `justCompleted: false` and moves
nothing. Both are covered directly in
`tests/analyticsAggregation.service.test.js`.

## 12. Conversion & AOV — raw counts only, computed at reporting time

Per §15/§16, `AnalyticsBucket` stores **no** derived rate or average field
— no `conversionRate`, no `avgOrderValue`. It stores the raw
numerators/denominators those are computed from, and nothing else:

```
visitorConversionRate  = orders / uniqueVisitors  × 100
sessionConversionRate  = orders / uniqueSessions   × 100
purchaseConversionRate = checkoutCompleted / checkoutStarted × 100   (checkout→purchase conversion)

averageOrderValue      = grossRevenueMinor / orders
averageItemsPerOrder   = unitsSold / orders
```

(`visitorConversionRate`'s numerator is `orders`, not a separately
deduplicated "distinct purchasing visitors" count — a visitor placing two
orders within the same bucket counts as two toward this numerator. A true
distinct-purchaser count would need a third uniqueness collection
alongside `AnalyticsVisitorBucket`/`AnalyticsSessionBucket`; given how
rarely one visitor completes multiple separate orders inside a single
hour/day window, Phase 8 does not add one — a documented simplification,
not an oversight.)

Every formula above divides by a count that can legitimately be zero (no
sessions yet this hour, no checkouts started yet) — computing these is a
future reporting layer's responsibility, including its zero-denominator
handling; Phase 8 only guarantees the inputs are always present, correct,
integer counts.

## 13. Idempotency & retry safety — the analytics claim

Phase 7 already protects the Visitor/Session/Commerce side of a retry via
Event's own `processingStatus === 'completed'` guard. Phase 8 needs its
**own** guard, because analytics aggregation runs as a separate step with
its own failure modes, and — critically — a BullMQ retry of a job that
failed *after* aggregation already partially succeeded must not re-apply
those increments.

```
AnalyticsEventProcessed { websiteId, eventId, processedAt }
  unique index: websiteId + eventId
```

`aggregateEvent()`'s flow:

```
1. claim(websiteId, eventId)     — create() the marker
     already exists (11000)?  →  return { aggregated: false } — someone
                                  already applied (or is applying) this
                                  event's analytics; do nothing more.
2. run all the bucket/product/uniqueness writes
3a. all succeed  → done, marker stays
3b. any throws   → release(websiteId, eventId) — delete the marker
                    (best-effort)
                    → rethrow, so eventProcessing.service.js fails the
                      whole attempt and BullMQ retries it
```

**Why claim-first, with a compensating delete on failure — not the
reverse:** the two possible orderings trade off differently:

- *Aggregate-first, claim-last*: a crash between finishing the writes and
  inserting the marker means a retry sees no marker, redoes every write —
  **double-counting**, an unrecoverable data-correctness problem.
- *Claim-first, delete-on-failure* (what Phase 8 does): an ordinary
  application-level failure (a bug, a bad value, a transient write error)
  triggers the compensating delete, so the very next retry sees no marker
  and safely redoes the work from scratch — no undercount, no overcount,
  the common case. The only remaining gap is a **hard process crash** in
  the narrow window between the claim succeeding and the compensating
  delete running (or the delete itself failing) — that leaves an orphaned
  marker, and every future retry for that one event permanently skips its
  analytics: an **undercount**, not an overcount.

This is a deliberate choice, following §25 directly: revenue/analytics
data that's occasionally slightly under-counted after a genuine process
crash is a far smaller problem than data that can be silently inflated by
an ordinary retry. Phase 8 does **not** claim exactly-once semantics — it
guarantees **at-most-once application per event**, with a narrow, honestly
documented undercount risk in the crash-during-cleanup case. Real MongoDB
transactions were considered (§25 explicitly invites this) and rejected
for the same reason Phase 6/7 already rejected them elsewhere in this
system: this deployment doesn't assume a replica set is available, and the
correctness property actually needed ("never double-count") doesn't
require one — see `tests/analyticsAggregation.service.test.js`'s
claim/release/retry tests for the behavior this produces in practice.

## 14. Atomic updates — always $inc + upsert, never read-modify-write

Every counter in `AnalyticsBucket`/`ProductAnalyticsBucket` is updated via
a single `findOneAndUpdate({...}, { $inc: {...} }, { upsert: true })` call
(`src/repositories/analytics/analytics.repository.js`,
`productAnalytics.repository.js`) — never `find()` → mutate in JavaScript
→ `save()`. This is what makes concurrent workers safe: two workers
incrementing the same bucket's `pageViews` at the same instant both apply
their `$inc` atomically at the database level; neither can silently lose
the other's update the way a find-then-save race could.

MongoDB upserts have one known race worth naming explicitly: two
concurrent `findOneAndUpdate({ upsert: true })` calls that are BOTH the
*first* write to a brand-new bucket can, in rare cases, both attempt the
insert and have one lose with a duplicate-key error despite `upsert: true`
— because the unique-index check and the insert aren't a single atomic
step relative to a second concurrent upsert. Both analytics repositories
catch that (`error.code === 11000`) and retry once as a plain update
against the document the other request just created — the exact same
"lost the race to create it first" pattern already used everywhere else in
this codebase (`Product`/`Cart`/`Order`/etc., Phase 3/5/6).

`tests/analyticsAggregation.service.test.js`'s concurrency suite exercises
this with `Promise.all` over 100 concurrent page-view events (and,
separately, concurrent add-to-cart and concurrent-purchase scenarios),
asserting the final counters land exactly on the expected value — never
off by one in either direction.

## 15. Product name snapshots — bucket-scoped, never retroactive

`ProductAnalyticsBucket.productNameSnapshot` is set from whatever product
name the triggering event carried, refreshed via a plain `$set` (not
`$setOnInsert`-only) on every write that has one available. This is safe
with respect to §28's "don't overwrite historical analytics" rule for a
structural reason, not a policy one: every upsert's filter is scoped to
*one specific bucket* (`websiteId + productId + granularity + bucket`), so
a later product rename writing to *today's* bucket can never touch
*yesterday's* bucket document — it isn't queried, filtered, or matched by
that write at all. `remove_from_cart` events (which only carry a raw
`productId`, never a name) leave `productNameSnapshot` untouched rather
than guessing or querying the Product collection an extra time just for a
label.

## 16. Currency snapshot (§29 — no conversion, ever)

`AnalyticsBucket.currency` and monetary fields never attempt currency
conversion. `resolveCurrency()` (`analyticsAggregation.service.js`) prefers
whichever normalized entity is already on the commerce descriptor —
`Order.currency`, then `Product.currency` — over the raw, client-supplied
`event.data.currency`, falling back to the raw field only when nothing
normalized was resolved (e.g. a bare `page_view`). This costs zero extra
database queries (no `Website.currency` lookup added to the hot processing
path) while still preferring already-validated data over raw client input
wherever it's available. A page-view-only bucket, which carries no
monetary counters, simply leaves `currency` unset — there's nothing to
contextualize.

## 17. Multi-currency

Every website in this system is expected to operate in one configured
currency (`Website.currency`, required — see `docs/DATABASE_ARCHITECTURE.md`).
Phase 8 does not implement any cross-currency conversion or reconciliation
(§29) — it is not asked to, and inventing one would risk silently
misrepresenting revenue. The schema is not a blocker to adding real
multi-currency support later (each bucket already carries its own
`currency` field, independent of every other bucket), but building that
support is explicitly out of scope for this phase.

## 18. Performance / index strategy

| Model | Indexes | Purpose |
|---|---|---|
| `AnalyticsBucket` | `{websiteId,granularity,bucket}` unique | the bucket identity; every write and future read goes through this |
| `ProductAnalyticsBucket` | `{websiteId,productId,granularity,bucket}` unique | per-product bucket identity |
| `AnalyticsVisitorBucket` | `{websiteId,granularity,bucket,anonymousId}` unique | the uniqueness claim |
| `AnalyticsSessionBucket` | `{websiteId,granularity,bucket,sessionId}` unique | the uniqueness claim |
| `AnalyticsEventProcessed` | `{websiteId,eventId}` unique | the idempotency claim |

No index exists here that isn't load-bearing for one of the guarantees
above (§34's "do not add arbitrary indexes"). Aggregation touches a small,
bounded number of documents per event — one `AnalyticsBucket` write and
zero-or-more `ProductAnalyticsBucket` writes per granularity, plus at most
one visitor-claim and one session-claim write per granularity — never a
full-collection scan, never an unbounded in-memory array, and (per §14)
never a find-then-save round trip. `mockAnalyticsRepositories.js`'s test
mocks deliberately perform their read-modify-write in a single synchronous
block precisely to keep this atomicity property meaningful under test,
without requiring a live MongoDB instance to prove it end-to-end.

## 19. Security

Analytics documents never store passwords, hashes, JWTs, card data, or raw
request payloads — every field on every model here is either a count, a
money-minor-units integer, a UTC `Date`, or an identifier already public
elsewhere in the system (`websiteId`, `externalProductId`, `anonymousId`,
`sessionId`, `eventId`). Ownership is always the server-resolved
`Website` document from the Phase 3 lookup already performed during
ingestion — nothing here trusts a client-supplied owner/tenant id. No
public endpoint exposes any of these five collections, their contents, or
their existence (§39/§40) — this phase is internal infrastructure only.

## 20. Eventual consistency (extends Phase 7's model)

Analytics numbers become visible in MongoDB only after the *entire* worker
pipeline succeeds for an event — Visitor/Session resolution, commerce
resolution, **and** analytics aggregation, in that order. A reader querying
`AnalyticsBucket` immediately after `POST /api/collect` returns `202` will
not see that event reflected yet; it will appear once the worker finishes
processing it, same as Phase 7's existing Visitor/Session/Order eventual-
consistency window (`docs/QUEUE_ARCHITECTURE.md` §"Eventual consistency").
Phase 8 does not shrink or widen that window — it adds one more thing that
has to finish before an Event is `completed`.

## 21. Future backfill (§32 — prepared for, not built)

`aggregateEvent()` is deterministic given `(event, visitor, session,
commerce)` — the same inputs always produce the same bucket writes,
regardless of when it's called. Nothing about the aggregation path assumes
"this is happening close to real time." A future backfill/reprocessing
tool could, in principle, replay historical Events through
`eventProcessingService.processEvent()` (or directly through
`analyticsAggregationService.aggregateEvent()` given a reconstructed
commerce descriptor) and produce numerically correct bucket writes — the
same idempotency claim (`AnalyticsEventProcessed`) would even prevent a
backfill from double-counting an event that was already aggregated
normally. No such tool is built this phase (§32 explicitly rules it in
scope only as a design constraint, not a deliverable).

## 22. Scope — what Phase 8 deliberately does not include

- No analytics dashboard, no frontend, no charts (§38).
- No public reporting API — `GET /analytics`, `GET /reports`, `GET
  /revenue`, `GET /orders/statistics`, or anything similar does not exist
  yet (§39). These collections are queried only from within this codebase
  today.
- No profit calculation — there is no reliable product-cost data source in
  this system, and §2 explicitly forbids inventing one.
- No currency conversion (§29).
- No refund event / refund-driven analytics updates — Phase 6 has no
  refund event, so `refundedAmountMinor` is always `0` in practice today
  (§9, above).
- No week/month granularity yet — the architecture supports adding it
  without a redesign (§5), but only `hour` and `day` are implemented now.
- No backfill/reprocessing CLI (§21, above).
