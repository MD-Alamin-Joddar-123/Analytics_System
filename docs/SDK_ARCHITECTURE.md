# Tracking SDK Architecture (Phase 11)

This document describes the universal, framework-agnostic browser
tracking SDK — `tracking.js` — and how it integrates with the existing
backend. It lives in `frontend/sdk/`, its own npm project, completely
separate from both the backend and the Phase 10 dashboard. See
`docs/SDK_INTEGRATION.md` for the customer-facing installation guide this
document's architecture supports.

## 1. Why a separate package

The dashboard (Phase 10) is a React application meant to be *built* and
*deployed*; the tracking SDK is a script meant to be *embedded* in
arbitrary third-party pages via a single `<script>` tag. These have
opposite constraints — the dashboard can depend on React, TanStack Query,
Recharts; the SDK must have **zero runtime dependencies**, no framework,
and a minimal footprint, because it ships to someone else's website, not
ours. Keeping it a fully separate package (`frontend/sdk/`, its own
`package.json`/`vite.config.ts`/test suite) makes this boundary structural,
not just a convention someone could accidentally violate by importing a
dashboard component into it.

## 2. Where the build output goes

```
frontend/sdk/src/*.ts  --(vite build, IIFE format)-->  backend/public/tracking.js
```

`frontend/sdk/vite.config.ts` sets `build.outDir` to point directly at
`backend/public/` — `npm run build` in `frontend/sdk/` produces the exact
file the backend serves, with no manual copy step. `backend/src/app.js`
adds one new route, `GET /tracking.js`, that serves this file — the
**only** backend change this phase made (see §9). This is what makes the
documented installation snippet (`docs/SDK_INTEGRATION.md`) — a single
`<script src="https://<domain>/tracking.js">` tag — actually resolve to a
real, working script from this repository, not just a theoretical example.

## 3. Module architecture

```
frontend/sdk/src/
├── index.ts       Entry point — the ONLY module-scope side effect
│                   (assigns window.Analytics, calls init(), guarded
│                   against duplicate loads)
├── api.ts          The public Analytics object; wires every other
│                   module together
├── config.ts       Discovers data-website-id / the collector URL from
│                   the executing <script> tag
├── identity.ts     Visitor id (localStorage) / session id
│                   (sessionStorage) generation & persistence
├── context.ts      Collects url/path/title/referrer/language/screen/
│                   timezone from the browser
├── payload.ts       Assembles the exact POST /api/collect request body
├── eventData.ts     Maps each public ecommerce method's input to the
│                    exact `data` shape the backend validator expects
├── types.ts          Public input types for the ecommerce methods
├── constants.ts      SUPPORTED_EVENTS mirror, storage keys, SDK_VERSION
├── transport.ts      sendBeacon-preferred delivery, fetch fallback,
│                     never throws
├── queue.ts           In-memory ordering buffer + unload-time flush
├── spa.ts              pushState/replaceState/popstate route tracking
├── domEvents.ts         data-analytics-event declarative click tracking
├── jsonld.ts             Opt-in schema.org Product auto-detection
├── storage.ts            try/catch-safe localStorage/sessionStorage
└── debug.ts               The one gated console logger (data-debug)
```

Every module has exactly one responsibility, matching the same
single-responsibility convention the backend's `services/`/`repositories/`
split already established — `api.ts` is the only module that imports
(almost) everything else; nothing downstream of it imports back up into
it, so the dependency graph stays a tree, not a web.

## 4. Script installation contract

```html
<script src="https://analytics.yourdomain.com/tracking.js" data-website-id="abc123"></script>
```

This is the **entire** required integration. `config.ts`'s `resolveConfig()`
discovers everything else from the script tag itself:

- **websiteId** — from `data-website-id`.
- **Collector endpoint** — derived from the script's own origin
  (`new URL(script.src).origin + '/api/collect'`), never a separately
  configured URL. The same domain serving `tracking.js` also serves
  `POST /api/collect` (§2/§9) — this is what makes "no manually specified
  API endpoint" actually true rather than aspirational.

`document.currentScript` is read **synchronously**, once, at module
top-level (`config.ts`'s `findScriptTag()`) — this is what makes `defer`
loading work correctly (`document.currentScript` is only reliable during
a script's own top-level execution, `null` again in any later callback).
A fallback scan of `document.getElementsByTagName('script')` for a tag
carrying `data-website-id` covers dynamic-injection loaders where
`currentScript` isn't set at all.

### Optional configuration (all via data attributes, all with sensible defaults)

| Attribute | Default | Effect |
|---|---|---|
| `data-debug` | `false` | Logs every internal decision to the console |
| `data-auto-pageview` | `true` | Automatic `page_view` on load and SPA navigation |
| `data-auto-spa` | `true` | Patches History API to detect SPA route changes |
| `data-auto-detect-jsonld` | `false` | Opt-in schema.org Product auto-detection (§7) |

## 5. Public API

```js
window.Analytics.init()             // idempotent; called automatically on load
window.Analytics.track(name, data)  // generic — any backend-supported event name
window.Analytics.pageView()
window.Analytics.productView({ productId, name, price, currency })
window.Analytics.addToCart({ productId, name, price, quantity, currency, cartId })
window.Analytics.removeFromCart({ productId, quantity, price, name, currency, cartId })
window.Analytics.checkout({ checkoutId, cartId, cartValue, itemCount, currency, items })
window.Analytics.purchase({ orderId, revenue, currency, items, checkoutId })
window.Analytics.getVisitorId()
window.Analytics.getSessionId()
window.Analytics.getWebsiteId()
window.Analytics.version
```

`init()` runs automatically the moment the script executes — a customer
never has to call it. It is still exposed and safe to call again (a no-op
after the first successful run) for advanced cases (e.g. a customer
wanting an explicit reference to confirm the SDK loaded).

**`CheckoutInput.itemCount`**: accepted in the call signature (matching
the documented example) but **never transmitted** — the backend's
checkout `data` contract
(`backend/src/validators/event.validator.js`'s `validateCheckoutData`)
has no such field. Sending it would mean inventing a field the backend
doesn't understand, which §"Event API" explicitly forbids ("The SDK must
map these into the EXISTING /api/collect payload format. Do not invent an
incompatible payload format."). Documented in `types.ts` and
`SDK_INTEGRATION.md`, not silently dropped without explanation.

## 6. Payload construction — exact contract compatibility

`payload.ts`'s `buildCollectPayload()` is the **one** place a request body
is assembled, and every field name matches
`backend/src/validators/event.validator.js`'s top-level fields exactly:
`websiteId`, `event`, `timestamp`, `eventVersion`, `url`, `path`, `title`,
`referrer`, `anonymousId`, `sessionId`, `language`, `screenWidth`,
`screenHeight`, `timezone`, `data`. `eventData.ts`'s five mapping
functions do the same for each event's nested `data` object — each one
reads only the fields that event's specific backend validator function
(`validateProductViewData`, `validateAddToCartData`, etc.) actually
checks, mirroring that file's own "only the fields explicitly named are
ever read" allow-list discipline on the client side too.

**This is proven, not just asserted**: `tests/integration.test.ts`
imports the REAL, unmodified `validateCollectEvent` middleware directly
from `backend/src/validators/event.validator.js` (a relative cross-package
import — that file has no npm-package dependencies of its own, only
sibling backend source files, so it resolves cleanly without needing
`backend/node_modules` installed inside `frontend/sdk/`) and runs every
SDK-constructed payload shape through it, asserting the real validator
accepts them — and separately, that it still correctly REJECTS an
unsupported event name or a payload missing a required field, proving the
SDK doesn't (and can't) work around backend validation.

## 7. Ecommerce auto-detection — bounded, honest, opt-in

Per §"Ecommerce Auto-Detection"'s explicit warning ("DO NOT pretend that
arbitrary websites can magically reveal exact ecommerce information"),
automatic detection is limited to two concrete, bounded mechanisms —
never DOM text scraping, never guessing:

1. **Declarative data attributes** (`domEvents.ts`) — a customer opts in
   per-element by adding `data-analytics-event="..."` plus the specific
   `data-*` fields that event needs (§"Data Attributes"). One delegated
   `click` listener on `document` catches these, including elements added
   to the DOM after load (no `MutationObserver` needed — event delegation
   naturally covers it). Only the explicitly named attributes are ever
   read; the clicked element's text content, classes, or any other
   attribute is never touched.
2. **schema.org JSON-LD** (`jsonld.ts`), **opt-in only**
   (`data-auto-detect-jsonld="true"`) — scans `<script
   type="application/ld+json">` blocks already on the page (the same
   structured data a site publishes for search engines) for a `Product`
   entity with a usable id. Returns nothing — fires no event — whenever
   the structure isn't an unambiguous match, rather than guessing.

For everything auto-detection can't reach (server-rendered checkout
totals with no JSON-LD, a custom SPA cart with no matching data
attributes), the explicit JS API
(`Analytics.addToCart(...)`/`checkout(...)`/`purchase(...)`) is the
documented, always-available path — this is the deliberate
**AUTO-DETECTION + EXPLICIT API** architecture §"Ecommerce Auto-Detection"
asks for, not detection alone.

## 8. Visitor and session identity

- **Visitor id** (`identity.ts`): generated once via
  `crypto.randomUUID()` (with graceful fallbacks for older browsers),
  persisted in `localStorage`. Opaque — never derived from IP, a browser
  fingerprint, email, or phone number, because none of those are ever
  read by any code in this SDK in the first place.
- **Session id**: generated the same way, persisted in `sessionStorage`
  — inherently per-tab, clearing when that tab/window closes. This is a
  deliberate choice: it gives session ids a sensible lifecycle **without
  the SDK implementing any inactivity-timeout logic of its own**. Per
  §"Session ID": *"Do not attempt to duplicate backend session-expiration
  logic in the SDK... If the backend decides that a session has expired
  and creates a new session internally, the SDK must continue to function
  correctly."* The SDK just keeps sending whatever session id the current
  tab has; Phase 5's `resolveSession` independently decides server-side
  whether that maps to an existing Session or a freshly started one —
  the SDK doesn't need to know or predict which.

## 9. Backend compatibility — the one change this phase made

**No existing business logic was modified.** The single backend change is
additive: `GET /tracking.js` (`backend/src/app.js`), a static-file route
serving the built SDK with a permissive, origin-agnostic CORS header
(harmless for a public script — plain `<script src>` loading doesn't
require CORS at all; the header only matters for a customer who adds
`crossorigin="anonymous"` to their tag) and a short cache lifetime. A
missing built file returns a clean 404 (`ApiError.notFound`, matching the
project's standard error envelope) rather than crashing or falling through
to a generic 500. This route touches nothing about `/api/collect`,
Phase 4-9's ingestion/queue/aggregation/reporting pipeline, or any
existing model/service/repository — verified by the full existing backend
test suite passing unchanged (see the Phase 11 final report for exact
counts).

Every other integration point (Phase 4's `/api/collect` contract, Phase
5's visitor/session resolution, Phase 6's commerce normalization, Phase
7's queue, Phase 8's aggregation, Phase 9's reporting) required **zero**
changes — the SDK was built entirely to the existing, unmodified contract.

## 10. Reliability: transport and the in-memory queue

`POST /api/collect` accepts exactly **one event per request** (unchanged,
Phase 4) — there is no batch-ingestion endpoint, and Phase 11 does not add
one (§"Queue / Retry in Browser": *"do NOT create another backend
collector"*). `queue.ts`'s in-memory buffer is therefore not a batching
mechanism; it provides two things:

1. **Ordering** — rapid-fire `track()` calls in the same tick are
   collected and dispatched, in order, on the next tick (`setTimeout(fn,
   0)`), rather than each racing its own immediate, unordered request.
2. **Reliable delivery on unload** — anything still queued when the page
   is hidden/unloaded (`visibilitychange`/`pagehide`) is flushed
   *synchronously*, using `sendBeacon` exclusively (never `fetch`, which
   is not guaranteed to complete once navigation begins).

Real durability — retries, dead-letter handling, guaranteed eventual
processing — remains **entirely the backend's responsibility** (Phase 7's
BullMQ queue). This buffer holds events in memory for, at most, a few
milliseconds under normal conditions; it is explicitly not, and does not
attempt to be, a substitute for that.

`transport.ts` prefers `navigator.sendBeacon()` (designed exactly for
"fire this and don't wait"), falling back to `fetch()` with `keepalive:
true` when `sendBeacon` is unavailable or declines the payload. Neither
path ever throws back into the caller — every failure mode (missing
browser APIs, a rejected fetch, an exception from either) is caught and
silently swallowed, satisfying §"Transport": *"Analytics failures must
fail silently from the customer's application's perspective."*

## 11. Duplicate-load / duplicate-init prevention

Two independent guards, at two different levels:

- **Module level** (`index.ts`): if `window.Analytics` already exists
  when this script executes, it does nothing further — no second
  `init()` call, no second set of listeners. This is what actually
  matters if `tracking.js` is accidentally included via two `<script>`
  tags, since each tag creates its own separate module/closure instance.
- **Function level** (`api.ts`'s `init()`): a second call within the
  *same* instance (e.g. a customer explicitly calling
  `Analytics.init()` again) is also a safe no-op, guarded by an internal
  `initialized` flag.

Both are tested directly (`tests/api.test.ts`).

## 12. Privacy and security

Nothing in this SDK reads, stores, or transmits: passwords, card numbers,
CVV, authentication tokens, cookies, arbitrary form field contents, or a
client-derived IP address. This isn't an enforced filter stripping
disallowed fields — it's structural: no module in this codebase calls
`document.cookie`, reads any `<input>` element's value, or has any API
available to it that could read a visitor's IP (`context.ts` only ever
reads `window.location`, `document.title`/`referrer`, `navigator.language`,
`window.screen`, and `Intl`). `domEvents.ts` reads only the specific,
named `data-*` attributes each declarative event documents — never an
element's text content or any other attribute. The only backend
configuration ever present in this SDK's source is the collector origin,
derived at runtime from the script's own `src` — no database URI, Redis
URL, JWT secret, or other backend/internal configuration exists anywhere
in `frontend/sdk/`.

## 13. Performance

Zero runtime dependencies. Built output: **~10.8 KB raw, ~3.8 KB
gzipped** (IIFE, minified — see `frontend/sdk/vite.config.ts`). No React,
no Node-specific APIs, no MongoDB/Redis client code — none of those are
importable from a module that only ever runs in a browser tab in the
first place. `init()` runs synchronously at script-evaluation time
(no `DOMContentLoaded` wait for anything that doesn't need it — only the
opt-in JSON-LD scan defers to `DOMContentLoaded` when the document is
still loading, since JSON-LD blocks can legitimately appear later in the
document than an un-deferred `<head>` script tag).

## 14. Future: product cost / profit

Per §"Important Business Requirement": revenue already flows from
`purchase`/order data (Phase 6/8/9, unchanged). **Profit is explicitly
NOT computed anywhere in this system** — no product-cost value is
fabricated by the SDK, the backend, or the dashboard. The architecture
is deliberately left open for a future, legitimate cost data source
without requiring a redesign:

- `eventData.ts`'s per-event mapping functions are the single seam where
  a future `costPrice`/`cost` field could be added to `LineItemInput` and
  threaded through to `data.items[].cost` — **if and only if** the
  backend's validator and normalized `Order`/`OrderItem` schema (Phase 6)
  are extended first to accept and store it. The SDK does not, and must
  not, get ahead of that by inventing a field the backend can't yet
  persist.
- Alternatively, a legitimate integration (e.g. a platform-specific
  connector reading a merchant's actual product cost from their catalog
  API) could report cost data through a **separate**, purpose-built
  backend endpoint/event in a future phase — not retrofitted into
  `purchase`'s revenue-reporting contract, which represents what the
  customer paid, not what the merchant paid for the goods.

Nothing in Phase 11 blocks either path; nothing in Phase 11 implements
either path.
