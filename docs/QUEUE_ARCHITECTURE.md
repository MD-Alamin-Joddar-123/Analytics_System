# Queue & Worker Architecture (Phase 7)

This document describes how `POST /api/collect` decouples **accepting** an
event from **processing** it, and the reliability guarantees (retries,
idempotency, failure handling, graceful shutdown) that decoupling is built
on. It complements `docs/DATABASE_ARCHITECTURE.md`, which covers what each
entity means; this document covers how an event actually gets there.

## Why this phase exists

Through Phase 6, event ingestion and processing (Visitor/Session
resolution, Product/Cart/Order upserts) happened synchronously inside the
`POST /api/collect` request. That had a real gap, explicitly flagged in
Phase 4 and Phase 6's own documentation: if the Event was persisted but
downstream processing then failed, a client retry would be recognized as a
duplicate (`websiteId + eventId` already exists) and the failed processing
would never automatically run again. Phase 7 closes that gap by moving
processing out of the request entirely, onto a durable, retryable queue.

## Ingestion flow (`POST /api/collect`)

```
Client
  │
  ▼
Validate (event.validator.js — unchanged since Phase 4/6)
  │
  ▼
Resolve + validate Website (must exist, must be active)
  │
  ▼
websiteId + eventId already exists?
  │
  ├── yes ──► enqueue a processing job for the existing Event
  │           (safe no-op if one is already queued/completed)
  │           return 200 { accepted: true, duplicate: true }
  │
  └── no ──► persist a new Event (processingStatus: 'pending')
              │
              ▼
             enqueue a processing job
              │
              ├── succeeds ──► return 202 { accepted: true, eventId }
              │
              └── fails ─────► return 503 QUEUE_UNAVAILABLE
                                (Event stays in MongoDB, pending — see
                                "Redis/queue failure" below)
```

`src/services/event/event.service.js` is now **ingestion only**. It has no
import of `visitorService`, `sessionService`, or any commerce service —
there is nothing left in that file that could do expensive or
failure-prone work inside the HTTP request. The endpoint's job is
`validate → persist → enqueue → respond`, full stop (§36).

## Processing flow (the worker)

```
Queue: "analytics-events"
  │
  ▼
Worker (src/workers/event.worker.js) — concurrency: WORKER_CONCURRENCY
  │
  ▼
eventProcessingService.processEvent(eventObjectId)
  │
  ├─ load Event by _id
  ├─ not found?            → log, complete the job (nothing to do)
  ├─ processingStatus
  │  already 'completed'?  → log, complete the job (safe no-op, §11)
  │
  ├─ mark processingStatus: 'processing', processingAttempts += 1
  │
  ├─ resolveVisitor  (src/services/visitor/visitor.service.js — Phase 5, unchanged)
  ├─ resolveSession  (src/services/session/session.service.js — Phase 5, unchanged)
  ├─ recordVisitorActivity / recordSessionActivity
  ├─ commerce dispatch (Product/Cart/Checkout/Order — Phase 6, unchanged)
  │
  ├─ success → mark processingStatus: 'completed', processedAt, link visitorId/sessionObjectId
  │
  └─ error   → mark processingStatus: 'failed', lastProcessingError
               rethrow → BullMQ registers a failed attempt, retries per policy
```

`src/services/event/eventProcessing.service.js` is the entire reusable
core here — it has no BullMQ or Redis import, and can be (and is) called
directly from tests with no queue infrastructure at all. The worker
(`src/workers/event.worker.js`) is a thin adapter: it takes a BullMQ job,
pulls `eventObjectId` out of `job.data`, and calls
`eventProcessingService.processEvent(eventObjectId)` — no business logic
of its own, exactly matching:

```
Worker → Event Processing Service → Visitor/Session/Commerce Services → Repositories → MongoDB
```

None of the Phase 5/6 business logic changed — `visitorService`,
`sessionService`, `productService`, `cartService`, `checkoutService`, and
`orderService` are the exact same modules, just invoked from a different
caller.

## The queue

- **Name**: `analytics-events` (`src/config/queue.js`).
- **Technology**: BullMQ + Redis (`bullmq`, `ioredis`). Never an in-memory
  array — the queue must survive a process restart, which only a durable,
  external store provides.
- **Job data**: `{ eventObjectId, websiteId, eventId }` — a *reference* to
  the already-persisted Event document, not a copy of the event payload
  (§5). Keeps the Redis payload tiny and means the worker always reads the
  current, authoritative document rather than a snapshot that could go
  stale.
- **Job ID**: deterministic — `` `${websiteId}:${eventId}` `` via
  `buildEventJobId()`. This is the queue-level half of idempotent job
  submission (§16): BullMQ treats adding a job with an already-used jobId
  as a no-op rather than creating a second job, so re-enqueueing the same
  event (e.g. from a duplicate-submission resubmission) is always safe to
  attempt, never something the caller needs to guard with its own
  pre-check first.

## Retry policy

Configured once, in `src/config/queue.js`'s `defaultJobOptions`, applied
to every job on this queue:

| Setting | Value | Configured via |
|---|---|---|
| `attempts` | 5 (default) | `QUEUE_ATTEMPTS` |
| `backoff` | exponential, base delay 1000ms (default) | `QUEUE_BACKOFF` |
| `removeOnComplete` | keep up to 1000 / 24h | hard-coded (bounded history, not unbounded) |
| `removeOnFail` | `false` — **never auto-removed** | hard-coded (§10) |

Exponential backoff means attempt *N* waits roughly
`QUEUE_BACKOFF * 2^(N-1)` before retrying — a short first retry, longer
gaps after repeated failures, never immediate hammering of a struggling
dependency. Nothing here is hard-coded to a "production-only" value; both
knobs are environment-driven.

## Failure handling — nothing is silently discarded

A job that keeps failing after `QUEUE_ATTEMPTS` attempts is **not**
deleted (`removeOnFail: false`). It sits in Redis, still inspectable,
functioning as a de facto dead-letter list until an operator or a future
cleanup job (§37 — not built this phase) removes it. Independently of
BullMQ's own job retention, the *Event document in MongoDB* — the durable
source of truth — carries its own permanent record of what happened:

```
processingStatus: 'failed'
processingAttempts: <N>
lastProcessingAttemptAt: <Date>
lastProcessingError: <string, capped at 1000 chars>
```

So even if Redis's job history were cleared, the failure is still visible
by querying Events with `processingStatus: 'failed'` — this is exactly
what the (deliberately non-website-scoped) `{ processingStatus: 1,
receivedAt: 1 }` index on `Event` exists to support for a future
reconciliation/retry tool.

## Idempotency — one source of truth, reused, not duplicated

Phase 7 adds **no second idempotency system**. Every guarantee it relies
on already existed:

- **Event existence**: `{ websiteId, eventId }` unique index (Phase 4) —
  a job may run `processEvent()` to completion, crash, and run again from
  a BullMQ retry; the Event document itself was only ever created once.
- **Visitor / Session**: `{ websiteId, anonymousId }` / `{ websiteId,
  sessionId }` unique indexes + find-then-create-with-duplicate-catch
  (Phase 5) — re-running `resolveVisitor`/`resolveSession` for the same
  identity always finds the existing document.
- **Product**: `{ websiteId, externalProductId }` unique index (Phase 6) —
  same pattern.
- **Cart / CartItem**: `{ websiteId, cartId }` / `{ websiteId, cartId,
  externalProductId }` unique indexes (Phase 6).
- **Checkout**: `{ websiteId, checkoutId }` unique index (Phase 6).
- **Order / OrderItem**: `{ websiteId, externalOrderId }` unique index +
  "OrderItems created only on the create branch, never the update branch"
  (Phase 6) — this is what makes "duplicate purchase does not duplicate
  order/items" hold even across a crash-and-retry.

What Phase 7 adds on top is a single guard, at the very top of
`processEvent()`: if the loaded Event's `processingStatus` is already
`'completed'`, skip all of the above entirely. This is what stops the
Visitor/Session/Cart **counter increments** (`eventCount`, `sessionCount`,
`pageViewCount`, `itemCount`, ...) — which, unlike document creation, are
not independently idempotent — from double-applying on an ordinary retry
of an already-finished job.

**Documented, accepted gap**: that guard cannot help if the process
crashes *between* an individual counter increment and the
`processingStatus: 'completed'` write — in that narrow window, a
subsequent retry would re-run the whole function and could increment a
counter a second time. This is the same class of tradeoff Phase 6 already
accepted for its incremental Cart totals, extended here. Closing it
completely would need either a transaction spanning every write in
`processEvent()` (see "Database consistency" below for why that's not
this phase's design) or a more granular per-side-effect idempotency
marker — a reasonable future refinement, not implemented now.

## Eventual consistency

Because processing is now asynchronous, an Event and the entities derived
from it are **not** written atomically:

```
12:00:00.000  Event persisted (processingStatus: 'pending'), 202 returned
12:00:00.050  Job picked up by the worker
12:00:00.070  Visitor/Session resolved and updated
12:00:00.090  Order + OrderItems created
12:00:00.095  Event marked 'completed'
```

A reader querying MongoDB at `12:00:00.060` would find the Event but not
yet the Order it produced. This is expected, not a bug — the collector's
contract was always "the event is durably accepted," never "every
downstream effect is visible the instant the HTTP response returns," and
Phase 4 already documented queueing as the intended eventual shape of this
system.

## Database consistency: no cross-collection transactions

`processEvent()` does **not** wrap its Visitor/Session/Commerce writes in
a MongoDB multi-document transaction. Per §22, this is deliberate: the
per-collection idempotency guarantees above already make every individual
write safely retryable on its own, and a job is allowed to run more than
once (that's the whole point of retries) — so the correctness property
this system needs is "replaying the same work is safe," not "all-or-
nothing across N collections," which a transaction would provide at real
cost (more Mongo round-trips, held locks, replica set requirement) for a
guarantee this design doesn't actually need.

## Redis architecture

- `src/config/redis.js` owns a single, lazily-constructed, reusable
  `ioredis` connection for the API process (§4) — shared by the queue
  producer and `/health`'s Redis check. Nothing constructs a connection
  merely by importing the module; it's created on first actual use.
- The **worker** process creates its own, separate Redis connection
  (`src/workers/event.worker.js`) rather than importing the API process's
  shared one — both because it's a different OS process (§19) and because
  BullMQ's `Worker` issues blocking reads that shouldn't share a
  connection used for other, non-blocking purposes.
- Connection options set `maxRetriesPerRequest: null` (required by
  BullMQ — commands wait across reconnects rather than failing fast) and
  an indefinite, capped-backoff `retryStrategy`. This is correct for a
  long-running server/worker process, and wrong for something that needs
  a bounded answer — which is exactly why `checkRedisHealth()` wraps its
  probe in an explicit 2-second timeout rather than trusting the
  connection to fail fast on its own.
- `REDIS_URL` is the only credential-bearing configuration, sourced from
  the environment, never hard-coded (§3/§27) and never returned by
  `/health` or any other endpoint.

## Health check (`GET /health`)

Now reports three independent pieces of state:

```json
{
  "success": true,
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "queue": "ready",
  "uptime": 123.45,
  "timestamp": "..."
}
```

`status` is `"healthy"` only when **every** dependency the collector
actually needs is up. A Redis outage now correctly reports `"degraded"`
(503) — not a cosmetic detail: `POST /api/collect` genuinely can't
guarantee processing without it (§21), so the health check reflecting that
accurately is the point, not an edge case to paper over.

## Worker concurrency

`WORKER_CONCURRENCY` (default 5) controls how many jobs one worker process
handles at once (`src/workers/event.worker.js`, passed straight to
BullMQ's `Worker` constructor). Concurrent execution is safe by
construction: every write path a job touches is one of the idempotent,
uniquely-indexed operations described above, so two jobs racing on the
same identity (two events for the same brand-new visitor, two purchases
for the same order) resolve the same way an accidental duplicate request
already did in Phase 3/5/6 — one wins the insert, the other catches the
duplicate-key error and reuses the winner's document.

## Graceful shutdown

Two separate processes, two separate shutdown sequences:

**API process** (`src/server.js`, on `SIGINT`/`SIGTERM`):
```
stop accepting new HTTP connections (server.close, waits for in-flight requests)
  → close the queue producer (eventQueueService.close())
  → close this process's Redis connection (disconnectRedis())
  → close MongoDB (disconnectDatabase())
  → exit(0)
```

**Worker process** (`src/workers/event.worker.js`, on `SIGINT`/`SIGTERM`):
```
stop accepting new jobs, let active ones finish (worker.close())
  → if that takes longer than 30s, force-close instead (worker.close(true))
  → close this process's Redis connection
  → close MongoDB
  → exit(0)
```

Order matters in both: HTTP/job intake stops first so nothing new starts
mid-shutdown, then infrastructure connections close in dependency order
(queue depends on Redis; nothing depends on MongoDB being closed last, but
closing it last means every other cleanup step that might still want to
log or finish a read has it available as long as possible).

## Process model

The API server and the worker are independent processes on purpose (§19) —
neither imports the other's entry point, and importing either module
without running it as the main module never starts anything (verified: no
Redis/BullMQ connection is attempted merely by `import`ing
`src/queues/event.queue.js` or `src/workers/event.worker.js`).

```bash
# Terminal 1 — API server
npm run dev        # or: npm start

# Terminal 2 — worker
npm run worker      # or: npm run start:worker
```

Both need `MONGODB_URI` and `REDIS_URL` pointing at the same MongoDB and
Redis instances. Scaling the worker independently of the API (e.g. running
several `npm run start:worker` processes against the same queue) works
without any code change — BullMQ distributes jobs across whichever workers
are listening, and every write path is already safe under concurrency for
the reasons above.

## Future-ready design (not implemented this phase)

`src/config/queue.js`'s `defaultJobOptions` and the `Queue`/`Worker`
wiring pattern in `src/queues/event.queue.js` / `src/workers/event.worker.js`
are generic — nothing about job naming, retry configuration, or the
lazy-connection pattern is specific to event processing. A future phase
adding analytics aggregation jobs, daily statistics, or cleanup jobs can
follow the same shape (a new queue name, a new job type, a new worker
processor calling into its own service) without touching this one.
