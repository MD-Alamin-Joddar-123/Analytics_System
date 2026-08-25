import { ssrfSafeFetch, DetectFetchError } from '../../utils/ssrfSafeFetch.js';
import {
  detectProductConfig,
  detectOrderConfig,
  detectCheckoutConfig,
  DetectionClassificationError,
} from './detectionEngine.js';

// DetectFetchError's messages are re-mapped through this table rather than
// shown as-is — they can carry incidental network/URL detail not worth
// exposing verbatim. DetectionClassificationError is different: its
// message is already the exact, deliberately-worded, user-facing text
// (crafted per field in detectionEngine.js's classification checks), so
// it's surfaced directly below rather than run through a second mapping
// that would just flatten it back down to something generic — the whole
// point of that check is explaining SPECIFICALLY why nothing was found.
const FETCH_ERROR_MESSAGES = {
  invalid_url: 'That is not a valid, fetchable URL.',
  blocked: 'That URL points at a network address this server is not allowed to reach.',
  unreachable: 'The page could not be reached.',
  timeout: 'The page took too long to respond.',
  too_large: 'The page response was too large to analyze.',
  too_many_redirects: 'The page redirected too many times.',
  unsupported_content_type: 'That URL did not return an HTML page.',
};

async function detectOneSide(url, run) {
  if (!url) return { fields: undefined, error: undefined };
  try {
    const { html, finalUrl } = await ssrfSafeFetch.fetchHtmlSafely(url);
    return { fields: run(html, finalUrl), error: undefined };
  } catch (error) {
    if (error instanceof DetectionClassificationError) {
      return { fields: undefined, error: { reason: error.reason, message: error.message } };
    }
    const reason = error instanceof DetectFetchError ? error.reason : 'unreachable';
    return { fields: undefined, error: { reason, message: FETCH_ERROR_MESSAGES[reason] ?? FETCH_ERROR_MESSAGES.unreachable } };
  }
}

// The only place that sees BOTH pages, and therefore the only place that
// can notice the two disagreeing about what a product id IS.
//
// A product id exists to join a product view to a purchase. When the order
// page can identify its line items ONLY by their link back to the product
// page (WooCommerce and most carts render no id attribute at all — see
// detectionEngine's product-link fallback), the id there is necessarily
// URL-derived. If the product page meanwhile reports a DOM id — WooCommerce
// exposes its internal `data-product_id="191"` — then every view is filed
// under "191" and every purchase under "path:/product/tableware-set", and
// the two halves of the funnel never meet. Both values are individually
// correct; the PAIR is unusable.
//
// So the product side is aligned to the scheme the order side can actually
// produce. This is deliberately one-directional: the order page has no way
// to produce "191", while both pages can always produce a URL path.
// Flagged with its own source so the dashboard shows WHY the id source
// says "url" when a perfectly good selector was found.
function alignProductIdentity({ product, order }) {
  const itemIdIsLinkDerived = order.orderItemIdSelector?.source === 'product-link';
  const productUsesSelector = product.productIdSource?.value === 'selector';
  if (!itemIdIsLinkDerived || !productUsesSelector) return;

  product.productIdSource = {
    value: 'url',
    confidence: 'medium',
    source: 'aligned-with-order-items',
  };
  // The selector is dropped rather than left behind: keeping it would save
  // a field the runtime now ignores, and re-reading this config later would
  // suggest an id scheme that is not in use.
  delete product.productIdSelector;
}

// Detects product and order config independently and in parallel — a
// failure fetching one URL (blocked, unreachable, timed out) never blocks
// the other side from still returning whatever it found, per §10's
// "partial results are still useful" requirement. Only throws when there
// is nothing at all to attempt or report back.
async function detectConfig(website, { productUrl, orderUrl, checkoutUrl }) {
  const [product, order, checkout] = await Promise.all([
    detectOneSide(productUrl, (html, finalUrl) => detectProductConfig(html, finalUrl)),
    detectOneSide(orderUrl, (html, finalUrl) => detectOrderConfig(html, finalUrl, website.currency)),
    detectOneSide(checkoutUrl, (html, finalUrl) => detectCheckoutConfig(html, finalUrl)),
  ]);

  const fields = { product: product.fields ?? {}, order: order.fields ?? {} };
  alignProductIdentity(fields);

  return {
    product: fields.product,
    productError: product.error,
    order: fields.order,
    orderError: order.error,
    checkout: checkout.fields ?? {},
    checkoutError: checkout.error,
  };
}

export const trackingConfigDetectionService = { detectConfig };
