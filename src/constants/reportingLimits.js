// Bounds for the reporting API's query parameters (Phase 9 §8/§11/§13).
// Centralized here so every validator/service reads the same numbers —
// nothing about pagination or date-range sanity is hard-coded inline at
// the call site.

// Pagination (§11): a safe maximum keeps a single request from forcing an
// unbounded MongoDB aggregation result set into memory.
export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

// Date-range sanity (§8, "reasonable date range"). Bounds differ by
// granularity because they bound the number of documents a report's
// aggregation pipeline will touch: an `hour` bucket range of 92 days is
// already ~2,200 documents; a `day` bucket range of 731 days (2 years) is
// ~731 documents — both comfortably small for a single aggregation call,
// while still covering every realistic dashboard use case (a merchant
// looking at intraday activity, or year-over-year trends).
export const MAX_RANGE_DAYS_BY_GRANULARITY = Object.freeze({
  hour: 92,
  day: 731,
});

export const DEFAULT_GRANULARITY = 'day';

// Phase 12.5 — Tracking Observability listing endpoints (visitors/sessions/
// events/orders). Their date-range filter is OPTIONAL (unlike the
// aggregate reports above, a raw activity list is still useful with no
// range at all — it's just page 1 of "most recent"), but when a range IS
// supplied it must still be bounded, for the same reason §8 bounds the
// aggregate reports: an unbounded range against an indexed but still
// per-document (not pre-aggregated) collection like Event could otherwise
// scan an unbounded number of documents.
export const OBSERVABILITY_MAX_RANGE_DAYS = 366;

// A detail page's bounded, non-paginated sub-lists (a session's event
// timeline, a visitor's recent events/session history) — small, fixed caps
// so a single pathological session/visitor can never force an unbounded
// response, without needing full pagination UI for what's meant to be a
// quick "recent activity" glance.
export const SESSION_TIMELINE_MAX_EVENTS = 500;
export const VISITOR_RECENT_EVENTS_MAX = 50;
export const VISITOR_SESSION_HISTORY_MAX = 50;
