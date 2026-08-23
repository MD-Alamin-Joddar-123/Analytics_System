import { ssrfSafeFetch, DetectFetchError } from '../../utils/ssrfSafeFetch.js';
import { detectProductConfig, detectOrderConfig, DetectionClassificationError } from './detectionEngine.js';

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

// Detects product and order config independently and in parallel — a
// failure fetching one URL (blocked, unreachable, timed out) never blocks
// the other side from still returning whatever it found, per §10's
// "partial results are still useful" requirement. Only throws when there
// is nothing at all to attempt or report back.
async function detectConfig(website, { productUrl, orderUrl }) {
  const [product, order] = await Promise.all([
    detectOneSide(productUrl, (html, finalUrl) => detectProductConfig(html, finalUrl)),
    detectOneSide(orderUrl, (html, finalUrl) => detectOrderConfig(html, finalUrl, website.currency)),
  ]);

  return {
    product: product.fields ?? {},
    productError: product.error,
    order: order.fields ?? {},
    orderError: order.error,
  };
}

export const trackingConfigDetectionService = { detectConfig };
