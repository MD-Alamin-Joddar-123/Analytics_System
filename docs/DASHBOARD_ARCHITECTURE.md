# Analytics Dashboard Architecture (Phase 10)

This document describes the frontend dashboard that consumes the Phase 9
Reporting API. It lives in `frontend/` — its own npm project, independent
of `backend/`, communicating with it over HTTP only. See
`docs/REPORTING_API_ARCHITECTURE.md` for the API this app is built on;
this document covers the client that calls it.

No frontend existed before this phase — `frontend/` was scaffolded fresh
(Vite's official `react-ts` template) rather than retrofitted onto an
existing app, per Phase 10's own instruction to "create a clean dedicated
dashboard frontend" when none exists.

## 1. Stack

React 19 + TypeScript, Vite 8, React Router 7, TanStack Query 5, Recharts
3, Tailwind CSS 4, Vitest + React Testing Library. One library per
concern — no second charting library, no second HTTP client, no second
state-management system alongside React Context.

## 2. Frontend architecture

```
src/
├── app/            React Query client (the app's ONE shared cache/dedup layer)
├── components/
│   ├── common/     Card, Button, Select, Badge, Skeleton, EmptyState, ErrorState, NoWebsiteSelected
│   ├── layout/     Sidebar, TopBar, DashboardLayout (the responsive shell)
│   ├── filters/    WebsiteSelector, DateRangePicker, GranularityToggle
│   ├── cards/      KpiCard
│   ├── charts/     ChartContainer (loading/error/empty wrapper), TimeSeriesLineChart
│   ├── tables/     ProductTable
│   └── dashboard/  ConversionFunnel (reused for both the conversion AND cart/checkout funnels)
├── pages/          One component per route
├── routes/         AppRoutes, ProtectedRoute
├── services/api/   client.ts (the ONLY fetch() call site) + auth.ts / websites.ts / reports.ts
├── context/        AuthContext, DashboardFiltersContext
├── hooks/          useAuth, useDashboardFilters, useReportQueryParams, one hook per report endpoint
├── utils/          money.ts / number.ts (display formatting ONLY), dateRange.ts, errors.ts
├── constants/      routes.ts
└── types/          api.ts — mirrors the Phase 9 response shapes field-for-field
```

`Modal`/`Drawer` from §25's suggested list is deliberately not built —
nothing in this phase's pages needs one; the mobile navigation is an
off-canvas panel (DashboardLayout), not a modal dialog. "Settings" from
§4's suggested sidebar is also omitted — there is no settings feature in
this phase, and a dead nav link would be worse than not having one.

## 3. Routing

```
/login
/dashboard                    -> redirects to /dashboard/overview
/dashboard/overview
/dashboard/ecommerce           (revenue + conversion funnel + cart/checkout funnel)
/dashboard/products
/dashboard/products/:productId
```

`AppRoutes.tsx` is the single source of route wiring; `constants/routes.ts`
is the single source of every path string (no route is hand-typed twice).
Dashboard pages are lazy-loaded (`React.lazy`) so the heaviest dependency
(Recharts) only loads once a page that actually charts something is
visited — the login screen's bundle never pays for it.

## 4. Authentication

Reuses Phase 2's JWT contract exactly — no second authentication system.

- `authApi.login/getCurrentUser/logout` (`services/api/auth.ts`) map 1:1
  to `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `AuthContext` is the single source of truth for `{ user, status }`
  (`'loading' | 'authenticated' | 'unauthenticated'`). On mount, a stored
  token is validated against `GET /api/auth/me` before the user is
  trusted — never assumed valid just because it's present in storage.
- The JWT itself lives in `localStorage` behind one module
  (`services/api/client.ts`'s `tokenStorage`) — nothing else in the app
  touches storage directly, and the token is never rendered in any
  component (§2).
- **Any** 401 from **any** API call — not just login — routes through a
  single `setUnauthorizedHandler` callback `AuthContext` registers once.
  This is what makes an expired/invalidated token discovered mid-session
  behave identically to an explicit logout everywhere in the app, not
  just on whichever endpoint happens to check first.
- `ProtectedRoute` redirects unauthenticated users to `/login`, preserving
  the page they were headed to (`location.state.from`) so a successful
  login sends them back.

## 5. Website selection

`WebsiteSelector` renders exactly the websites `GET /api/websites`
returned — nothing is filtered, guessed, or assumed client-side; the
backend's own ownership check (Phase 3/9) is the only authorization
boundary that exists. The first website is auto-selected once the list
loads, so the dashboard is never blank on first visit.

Selected website, date range, and granularity live in
`DashboardFiltersContext` — shared across Overview/Ecommerce/Products so
a KPI on one page and a chart on another always describe the same slice
of data. Product-table pagination/sort are deliberately **not** in this
shared context — they're local state on `ProductsPage`, since they only
mean something on that one page.

**Resetting incompatible selections**: `DashboardLayout` watches for a
website change and, if the user is currently on a product-detail route
(`/dashboard/products/:productId`), navigates back to `/dashboard/products`
— a product detail view is scoped to one product on one website, and
switching websites makes whatever `:productId` is in the URL meaningless.

## 6. API layer

`services/api/client.ts`'s `apiRequest()` is the **only** place `fetch()`
is called anywhere in this app (§17) — every component/hook goes through
one of `authApi`/`websitesApi`/`reportsApi`, never `fetch`/`axios` directly.
It centralizes:

- the base URL (`VITE_API_BASE_URL` — the **only** backend configuration
  ever exposed to the frontend, §20),
- the `Authorization: Bearer <token>` header (added automatically unless
  a call explicitly opts out, e.g. login),
- JSON encoding/decoding,
- mapping every non-2xx response to one typed `ApiRequestError` (status +
  backend error code + message) — the shape every error-handling piece of
  UI (`ErrorState`, `utils/errors.ts`) consumes uniformly,
- distinguishing a genuine network failure (status `0`) from a server
  response that failed (any real HTTP status).

## 7. Reporting endpoints consumed

| Hook | Endpoint |
|---|---|
| `useOverview` | `GET /api/reports/:websiteId/overview` |
| `useTimeSeries` | `GET /api/reports/:websiteId/timeseries` |
| `useProducts` | `GET /api/reports/:websiteId/products` |
| `useProductDetail` | `GET /api/reports/:websiteId/products/:productId` |
| `useConversion` | `GET /api/reports/:websiteId/conversion` |
| `useCartCheckout` | `GET /api/reports/:websiteId/cart-checkout` |
| `useRevenue` | `GET /api/reports/:websiteId/revenue` |

Every hook is a thin `useQuery` wrapper (`@tanstack/react-query`) around
one `reportsApi` function — no hook computes, aggregates, or reinterprets
a value the backend response doesn't already contain (§27: "Do NOT create
a second analytics calculation engine in the frontend"). `useOverview`,
`useTimeSeries`, `useRevenue`, `useConversion`, and `useCartCheckout` all
share their website/date-range/granularity inputs via
`useReportQueryParams()` — one place reading `DashboardFiltersContext`,
not five.

## 8. State management

React Context + hooks only — no Redux, no other state library (§18),
since the actual state surface is small: `AuthContext` (who's logged in)
and `DashboardFiltersContext` (website/date-range/granularity). Every
other piece of "state" (report data, loading, error) is React Query's
cache, not component state — nothing fetched from the API is duplicated
into `useState` anywhere. Pagination/sort for the product table is the one
genuinely page-local piece of state, kept in `ProductsPage` itself.

## 9. Caching / request deduplication

One shared `QueryClient` (`app/queryClient.ts`). React Query's own
query-key matching handles §19's "avoid duplicate requests for identical
website + date-range + granularity + endpoint" automatically — every
report hook's query key is `[reportName, websiteId, from, to, granularity, ...pageSpecificParams]`,
so switching back to a previously-viewed combination serves from cache
instead of re-fetching, with no bespoke cache implemented by hand. Product
list pagination uses `placeholderData: keepPreviousData` so paging doesn't
flash a skeleton between pages. `staleTime: 30s` and
`refetchOnWindowFocus: false` keep the dashboard from re-fetching more
than a human dashboard session actually needs.

## 10. Date range and granularity

`utils/dateRange.ts` computes every preset (Today/Yesterday/Last 7 Days/
Last 30 Days/This Month/Last Month) from the **browser's local calendar
day**, then converts to UTC via `Date#toISOString()` — the exact format
Phase 9's `from`/`to` query parameters expect (bucket matching is
`bucket >= from AND bucket < to`, always UTC — see
`docs/REPORTING_API_ARCHITECTURE.md` §8). This conversion is never silent:
`DateRangePicker` always renders the actual resulting UTC instant range
next to the preset name, so a "Today" selection that spans, say,
`2026-08-19T14:00Z`–`2026-08-20T14:00Z` in a UTC-15 timezone is visible,
not hidden behind the label. Custom ranges only apply on an explicit
"Apply" click — typing in the two date inputs never fires a request per
keystroke (§8).

`GranularityToggle` is a simple two-state `hour`/`day` control, matching
Phase 9's own supported values exactly (`SUPPORTED_GRANULARITIES` on the
backend) — there is no third option to keep in sync.

## 11. Conversion / cart-checkout — no alternative formulas

`ConversionFunnel` (`components/dashboard/`) is a single, dependency-free,
proportional-bar component reused for both the Ecommerce page's
conversion funnel (Product Views → Add to Cart → Checkout Started →
Checkout Completed → Orders) and its cart/checkout funnel (Carts Created →
Checkout Started → Checkout Completed). It renders exactly the counts and
rates passed to it — **every** rate displayed comes directly from a
`conversionRates` field the backend already computed
(`addToCartRate`/`visitorConversionRate`/`sessionConversionRate`/
`purchaseConversionRate`/`cartToCheckoutRate`/`checkoutCompletionRate`);
the component itself computes no ratio of its own (only the visual bar
width, which is a proportion for layout, not an analytics metric). This
was a deliberate correction during development — an earlier draft computed
step-to-step percentages inline, which was removed specifically to avoid
any appearance of "a second conversion formula" (§9/§27).

## 12. Charts

Recharts is the only chart library. `TimeSeriesLineChart` is one reusable
component parameterized by which `TimeSeriesPoint` field to plot, used
five times on the Overview page (Revenue, Orders, Unique Visitors, Unique
Sessions, Page Views) rather than five near-duplicate chart components.
`ChartContainer` wraps every chart with the shared loading
(`ChartSkeleton`) / error (`ErrorState`) / empty (`EmptyState`) handling —
a chart component itself only ever needs to render real, non-empty data.
Charts use Recharts' `ResponsiveContainer` so they resize with their
parent rather than fixing a pixel width (§21).

## 13. Money and number formatting — display only

`utils/money.ts`/`utils/number.ts` format already-computed values via
`Intl.NumberFormat` — **no arithmetic** happens in either file, and no
component anywhere in this app adds, divides, or otherwise recomputes a
monetary or count value (§6/§16). `formatMoney`/`formatNumber`/`formatRate`
all defensively fall back to a clean `'—'`/`'0'`/`'0%'` for a non-finite
input, even though the backend already guarantees clean numbers
(Phase 9 §1) — belt-and-suspenders, not a place a real value is expected
to fail.

## 14. Loading, empty, and error states

Every data-driven view distinguishes three states explicitly:

- **Loading** — `Skeleton`-based placeholders (`KpiCardSkeleton`,
  `ChartSkeleton`, `TableRowsSkeleton`) shaped like the real content, never
  a blank screen or a single global spinner (§14). Independent sections
  (KPI cards vs. a chart vs. the product table) load independently — each
  is its own `useQuery`, not one page-wide loading gate.
- **Empty** — a successful response with nothing in it (`EmptyState`) —
  visually calmer than an error, since nothing actually went wrong.
- **Error** — a failed request (`ErrorState`), always showing the message
  `utils/errors.ts` maps from the failure's HTTP status, never a raw
  backend message or stack trace for 5xx-class failures. A "Try again"
  action appears only when the failure is actually retryable (429/5xx/
  network) — retrying a 401/403/404 wouldn't fix anything.

## 15. Error handling by status

| Status | Behavior |
|---|---|
| 400 | Show the backend's own (already user-facing) validation message |
| 401 | `AuthContext` clears the session; `ProtectedRoute` redirects to `/login` |
| 403 | "You don't have permission to view this." |
| 404 | "We couldn't find that." (used directly by ProductDetailPage for an unknown product) |
| 429 | "Too many requests. Please wait a moment and try again." + retry action |
| 500/503 | "The server is temporarily unavailable. Please try again shortly." + retry action |
| network failure | The `ApiRequestError(0, ...)` message, distinct from a real 5xx |

## 16. Refresh

`TopBar`'s Refresh button calls `queryClient.invalidateQueries()` with no
filter — React Query only actually **refetches** queries that are
currently mounted/observed ("active"); an unmounted page's cached data is
just marked stale, not eagerly refetched. This means one call does exactly
"refresh whatever the user is looking at right now," with website, date
range, granularity, and pagination all naturally preserved, since none of
that component state changes — only the query results backing it. The
button is disabled while any query is in flight (`useIsFetching() > 0`),
preventing duplicate concurrent refreshes (§16).

## 17. Security model

- The frontend trusts nothing about ownership, revenue, order counts, or
  conversion math — every number rendered came directly from a Phase 9
  response; the backend is the sole authority (§20).
- The only backend configuration ever present in frontend code or env
  files is `VITE_API_BASE_URL`. No database URI, Redis URL, JWT signing
  secret, or other backend/internal configuration exists anywhere in
  `frontend/`.
- The JWT is never rendered in the UI and is only ever read from/written
  to `localStorage` through the single `tokenStorage` module.
- Website ownership is enforced entirely server-side (Phase 9 §9); the
  frontend's website selector only ever displays what the backend already
  filtered to the authenticated user.

## 18. Responsive strategy

Tailwind's default breakpoints (`sm`/`lg`) drive the layout:

- **Desktop/laptop (`lg` and up)**: a fixed sidebar plus main content,
  side by side.
- **Tablet/mobile (below `lg`)**: the sidebar becomes an off-canvas drawer
  (`DashboardLayout`), opened via a menu button in `TopBar` and closed by
  either its own close button or a backdrop click.
- KPI card grids collapse from 4 columns down to 2 (`grid-cols-2
  sm:grid-cols-3 lg:grid-cols-4`); chart grids collapse from 2 columns to
  1; tables scroll horizontally within their own container
  (`overflow-x-auto`) rather than ever causing the whole page to scroll
  sideways (§21).
- Charts resize via Recharts' `ResponsiveContainer`, not a fixed pixel
  width.

## 19. Accessibility

Every interactive element is a real, semantic HTML control — `<button>`,
`<select>`, `<input>`, `<label>` — never a `<div onClick>` (§22). Sort
columns use `aria-sort`; the granularity toggle uses `aria-pressed`;
loading skeletons carry `role="status"`; error regions use `role="alert"`;
the pagination control is a labeled `<nav>`. `index.css` defines a visible
`:focus-visible` ring globally, never suppressed. `Badge` (used nowhere
load-bearing yet, but built per §25) is always a labeled text pill, never
color alone.

## 20. No mock data (§27)

Every page fetches from the real `reportsApi`/`websitesApi`/`authApi`
functions, which call the real backend. If the backend is unreachable or
returns an error, the page shows the genuine `ErrorState` — there is no
fallback/demo dataset anywhere in this codebase, and no code path that
substitutes a fabricated number for a failed request.

## 21. Testing status

`npm test` (Vitest + React Testing Library) covers: authentication (login
success/failure, protected-route redirect, expired-session handling),
website selection (rendering only backend-returned websites,
auto-selection, switching, empty/error states), the Overview page (real
data rendering, zero-activity safety, error state), the product table
(pagination boundaries, sort-click behavior, loading/empty/error states,
no raw `_id` ever rendered), the responsive mobile navigation drawer, and
every `utils/` module (money/number formatting's NaN/Infinity safety,
date-range UTC conversion, error-message mapping) and the API client
(auth header inclusion, error mapping, the 401 handler, network-failure
handling). All tests mock at the `services/api/*` boundary — the real
backend is never required to run `npm test`, matching the same
repository-boundary mocking philosophy the backend's own test suite uses.
`npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly.
