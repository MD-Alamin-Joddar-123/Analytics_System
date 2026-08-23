// Controlled vocabularies for WebsiteTrackingConfig (the dashboard-driven,
// zero-template-change detection system) — same closed-set-in-one-shared-
// file pattern as constants/orderStatuses.js.

// How the SDK should extract ecommerce data for a given website. Kept as
// an explicit field (not inferred) so a dashboard user's config choice is
// unambiguous, and so future detection strategies (datalayer/jsonld/
// data_attribute — all already independently supported by the SDK, see
// docs/SDK_ARCHITECTURE.md) can be selected per-website without a schema
// change to add another mode later.
export const DETECTION_MODES = ['selector_regex', 'datalayer', 'jsonld', 'data_attribute'];

export const DEFAULT_DETECTION_MODE = 'selector_regex';

// Where the product identifier comes from when detectionMode is
// 'selector_regex': parsed out of the URL itself (e.g. "/product/:id"), or
// read from a CSS selector's element/attribute on the page.
export const PRODUCT_ID_SOURCES = ['url', 'selector'];

export const DEFAULT_PRODUCT_ID_SOURCE = 'url';
