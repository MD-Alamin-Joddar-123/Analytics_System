import { ssrfSafeFetch, DetectFetchError } from '../../utils/ssrfSafeFetch.js';
import {
  detectProductConfig,
  detectOrderConfig,
  detectCheckoutConfig,
  DetectionClassificationError,
} from './detectionEngine.js';

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
    return { fields: run(html, finalUrl, url), error: undefined };
  } catch (error) {
    if (error instanceof DetectionClassificationError) {
      return {
        fields: error.partialFields,
        error: { reason: error.reason, message: error.message },
      };
    }
    const reason = error instanceof DetectFetchError ? error.reason : 'unreachable';
    return { fields: undefined, error: { reason, message: FETCH_ERROR_MESSAGES[reason] ?? FETCH_ERROR_MESSAGES.unreachable } };
  }
}

function alignProductIdentity({ product, order }) {
  const itemIdIsLinkDerived = order.orderItemIdSelector?.source === 'product-link';
  const productUsesSelector = product.productIdSource?.value === 'selector';
  if (!itemIdIsLinkDerived || !productUsesSelector) return;

  product.productIdSource = {
    value: 'url',
    confidence: 'medium',
    source: 'aligned-with-order-items',
  };
  delete product.productIdSelector;
}

async function detectConfig(website, { productUrl, orderUrl, checkoutUrl }) {
  const [product, order, checkout] = await Promise.all([
    detectOneSide(productUrl, (html, finalUrl) => detectProductConfig(html, finalUrl)),
    detectOneSide(orderUrl, (html, finalUrl) => detectOrderConfig(html, finalUrl, website.currency)),
    detectOneSide(checkoutUrl, (html, finalUrl, requestedUrl) => detectCheckoutConfig(html, finalUrl, requestedUrl)),
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
