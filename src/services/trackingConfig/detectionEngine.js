import * as cheerio from 'cheerio';

// Pure, no-I/O heuristic analysis of a single page's HTML for Auto Detect
// Configuration. Every function here returns either a usable
// `{ value, confidence, source }` or nothing at all — NEVER a guessed
// selector that merely "looks right" (§10's explicit requirement). Every
// selector this module hands back has already been verified, by actually
// querying the parsed document, to match exactly what it's supposed to
// match — the same discipline `frontend/src/utils/selectorGenerator.js`
// already established for the client-side picker, ported here to
// cheerio's query engine so it works against a server-fetched document.
//
// This module never touches the network or the database — it is handed
// already-fetched HTML strings by trackingConfigDetection.service.js,
// which is what keeps it trivially unit-testable with plain HTML fixtures.
//
// --- Layered detection strategy -------------------------------------------
//
// Every field is resolved by walking three priority layers in order and
// stopping at the first that produces a VERIFIED selector. The layer that
// produced a value is exactly what its confidence badge reports, so the
// dashboard's "review this before saving" nudge is driven by how the value
// was found rather than by an opaque score:
//
//   P1 `structured`  — JSON-LD, microdata, RDFa, Open Graph  -> high
//   P2 `platform`    — Shopify/WooCommerce/data-attr/naming  -> medium
//   P3 `heuristic`   — headings, currency patterns, button text -> low
//
// Lower layers are never consulted while a higher one has produced a
// usable answer, and no layer ever emits a selector it has not first
// re-queried against the document to confirm it matches.

const SEMANTIC_ATTRS = ['data-testid', 'data-test', 'data-qa', 'itemprop', 'name'];
const MAX_CLASSES = 4;
const MAX_STRUCTURAL_DEPTH = 4;

// Thrown when the FETCHED PAGE ITSELF isn't the kind of page detection can
// work on at all — a listing/grid page, a login-redirect, or a near-empty
// JS-rendered shell. Distinguishing this from "detection genuinely found
// nothing" matters: the previous behavior silently returned an empty
// result for all three (indistinguishable from "this really is a product
// page with unusual markup"), which is exactly the confusing "We
// couldn't find that" outcome that prompted this check. Reported the same
// way `DetectFetchError` already is — a `{ reason, message }` shape the
// service layer surfaces verbatim to the dashboard.
class DetectionClassificationError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'DetectionClassificationError';
    this.reason = reason; // 'listing_page' | 'login_required' | 'js_rendered_empty' | 'order_signals_missing'
  }
}

function escapeIdent(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function tagNameOf($el) {
  const el = $el.get(0);
  return el && el.type === 'tag' ? el.tagName.toLowerCase() : undefined;
}

function isUniqueMatch($, selector, $el) {
  try {
    const found = $(selector);
    return found.length === 1 && found.get(0) === $el.get(0);
  } catch {
    return false;
  }
}

function isUniqueWithin($scope, selector, $el) {
  try {
    const found = $scope.find(selector);
    return found.length === 1 && found.get(0) === $el.get(0);
  } catch {
    return false;
  }
}

// The same id > semantic-attribute > class > structural-position cascade
// selectorGenerator.js already uses client-side, ported to cheerio.
// `matchFn` lets callers scope uniqueness to a container (order-item
// fields) instead of the whole document (page-level fields).
function buildSelectorCascade($el, matchFn) {
  const id = $el.attr('id');
  if (id) {
    const selector = `#${escapeIdent(id)}`;
    if (matchFn(selector, $el)) return { selector, tier: 'id' };
  }

  for (const attr of SEMANTIC_ATTRS) {
    const value = $el.attr(attr);
    if (!value) continue;
    const selector = `[${attr}="${value}"]`;
    if (matchFn(selector, $el)) return { selector, tier: 'attribute' };
  }

  const tag = tagNameOf($el);
  const classes = ($el.attr('class') || '').split(/\s+/).filter(Boolean).slice(0, MAX_CLASSES);
  for (let n = 1; n <= classes.length; n += 1) {
    const combo = classes.slice(0, n).map(escapeIdent).join('.');
    const selector = tag ? `${tag}.${combo}` : `.${combo}`;
    if (matchFn(selector, $el)) return { selector, tier: 'class' };
  }

  const parts = [];
  let current = $el;
  for (let depth = 0; depth < MAX_STRUCTURAL_DEPTH; depth += 1) {
    const currentTag = tagNameOf(current);
    if (!currentTag) break;
    const index = current.prevAll(currentTag).length + 1;
    parts.unshift(`${currentTag}:nth-of-type(${index})`);
    const selector = parts.join(' > ');
    if (matchFn(selector, $el)) return { selector, tier: 'structural' };
    const parent = current.parent();
    if (!parent.length || tagNameOf(parent) === 'html' || tagNameOf(parent) === undefined) break;
    current = parent;
  }

  return null;
}

function buildSelector($, $el) {
  return buildSelectorCascade($el, (selector, el) => isUniqueMatch($, selector, el));
}

function buildSelectorWithin($scope, $el) {
  return buildSelectorCascade($el, (selector, el) => isUniqueWithin($scope, selector, el));
}

// selectorGenerator.js's tiers are a strict ordinal preference, not a
// numeric score — the same ordinal is reused here, mapped onto this
// feature's high/medium/low vocabulary so the dashboard can show a single
// consistent confidence badge regardless of which detector produced it.
const TIER_CONFIDENCE = { id: 'high', attribute: 'high', class: 'medium', structural: 'low' };

// The layer a value came from IS its confidence (see the header comment).
const LAYER_CONFIDENCE = { structured: 'high', platform: 'medium', heuristic: 'low' };

const CONFIDENCE_ORDER = ['low', 'medium', 'high'];

function lowerOf(a, b) {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

// A value can be perfectly trustworthy (straight out of JSON-LD) while the
// only selector we could build for its rendered element is a fragile
// `:nth-of-type` chain. Confidence describes what the DASHBOARD will
// actually save — a selector — so a structural-tier selector caps the
// badge one notch below its layer, however good the underlying value was.
function confidenceFor(layer, tier) {
  const base = LAYER_CONFIDENCE[layer];
  return tier === 'structural' ? lowerOf(base, 'medium') === base ? base : 'medium' : base;
}

function confidenceForSelector(layer, tier) {
  const base = LAYER_CONFIDENCE[layer];
  if (tier !== 'structural') return base;
  // one notch down, floored at 'low'
  const index = CONFIDENCE_ORDER.indexOf(base);
  return CONFIDENCE_ORDER[Math.max(0, index - 1)];
}

// =========================================================================
// PRIORITY 1 — Structured data
// =========================================================================
//
// Structured data is authored specifically to be machine-read, so when
// present it is the most reliable source of TRUTH about a value — but only
// microdata and RDFa also tell us WHERE that value is rendered, because
// they annotate the visible element itself. JSON-LD and Open Graph live in
// <script>/<meta> tags that the SDK's selector_regex mode cannot read at
// runtime (that's what the independent 'jsonld' detection mode is for), so
// for those two the value is used as a search key: we go find the visible
// element that renders it, and build the selector from THAT. Either way the
// selector handed back points at a real, verified, rendered element.

function jsonLdNodes(parsed, out = []) {
  if (!parsed || typeof parsed !== 'object') return out;
  if (Array.isArray(parsed)) {
    for (const item of parsed) jsonLdNodes(item, out);
    return out;
  }
  out.push(parsed);
  if (Array.isArray(parsed['@graph'])) for (const item of parsed['@graph']) jsonLdNodes(item, out);
  return out;
}

function hasJsonLdType(node, wanted) {
  const type = node['@type'];
  if (typeof type === 'string') return type === wanted;
  return Array.isArray(type) && type.includes(wanted);
}

function readJsonLdByType($, wanted) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    for (const node of jsonLdNodes(parsed)) {
      if (node && typeof node === 'object' && hasJsonLdType(node, wanted)) nodes.push(node);
    }
  });
  return nodes;
}

function readJsonLdProducts($) {
  return readJsonLdByType($, 'Product').map((node) => {
    const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
    return {
      name: typeof node.name === 'string' ? node.name : undefined,
      id: node.sku || node.productID || node.gtin13 || node.gtin || node.mpn,
      price: offer && offer.price !== undefined ? Number(offer.price) : undefined,
    };
  });
}

// schema.org/Order has no single canonical "total" property in the wild —
// these are the shapes actually emitted by the common cart platforms,
// checked deepest-specific first.
function readJsonLdOrders($) {
  return readJsonLdByType($, 'Order').map((node) => {
    const invoice = node.partOfInvoice || node.referencesOrder;
    const due = invoice?.totalPaymentDue ?? node.totalPaymentDue;
    const rawTotal = due?.price ?? node.totalPrice ?? node.price;
    return {
      id: node.orderNumber || node.confirmationNumber || node.orderId,
      total: rawTotal !== undefined && rawTotal !== null ? Number(rawTotal) : undefined,
    };
  });
}

// Microdata/RDFa annotate the rendered element, so the VALUE may live in a
// `content` attribute while the human-readable text sits in the same node.
// Both are returned: the value for cross-checking, the element for the
// selector.
function annotatedValue($el) {
  if (!$el || !$el.length) return undefined;
  const tag = tagNameOf($el);
  if (tag === 'meta') return $el.attr('content');
  if (tag === 'link') return $el.attr('href');
  const content = $el.attr('content');
  if (content) return content;
  const text = $el.text().trim();
  return text || undefined;
}

// An element only makes a usable selector if the SDK can read the value out
// of its rendered text at runtime — a bare <meta itemprop="price"> renders
// nothing, so it is kept as a value but discarded as a selector target.
function renderableElement($el) {
  if (!$el || !$el.length) return undefined;
  const tag = tagNameOf($el);
  if (tag === 'meta' || tag === 'link' || tag === undefined) return undefined;
  return $el.text().trim() ? $el : undefined;
}

function readMicrodataProduct($) {
  const $scope = $('[itemscope][itemtype*="Product" i]').first();
  if (!$scope.length) return null;

  const $name = $scope.find('[itemprop="name"]').first();
  const $price = $scope.find('[itemprop="price"]').first();
  const $sku = $scope.find('[itemprop="sku"], [itemprop="productID"], [itemprop="mpn"], [itemprop="gtin13"]').first();

  const rawPrice = annotatedValue($price);
  return {
    layer: 'structured',
    source: 'microdata',
    name: annotatedValue($name),
    price: rawPrice === undefined ? undefined : Number(String(rawPrice).replace(/[^\d.]/g, '')),
    id: annotatedValue($sku),
    elements: {
      name: renderableElement($name),
      price: renderableElement($price),
      id: renderableElement($sku),
    },
  };
}

function readRdfaProduct($) {
  const $scope = $('[typeof~="Product"], [typeof~="schema:Product"], [typeof="Product"]').first();
  if (!$scope.length) return null;

  const $name = $scope.find('[property="name"], [property="schema:name"]').first();
  const $price = $scope.find('[property="price"], [property="schema:price"]').first();
  const $sku = $scope.find('[property="sku"], [property="schema:sku"], [property="productID"]').first();

  const rawPrice = annotatedValue($price);
  return {
    layer: 'structured',
    source: 'rdfa',
    name: annotatedValue($name),
    price: rawPrice === undefined ? undefined : Number(String(rawPrice).replace(/[^\d.]/g, '')),
    id: annotatedValue($sku),
    elements: {
      name: renderableElement($name),
      price: renderableElement($price),
      id: renderableElement($sku),
    },
  };
}

function metaContent($, property) {
  return $(`meta[property="${property}" i], meta[name="${property}" i]`).first().attr('content');
}

function readOpenGraphProduct($) {
  const type = (metaContent($, 'og:type') || '').toLowerCase();
  const rawPrice = metaContent($, 'product:price:amount') ?? metaContent($, 'og:price:amount');
  const isProduct = type === 'product' || type === 'og:product' || type.startsWith('product.') || rawPrice !== undefined;
  if (!isProduct) return null;

  return {
    layer: 'structured',
    source: 'open-graph',
    name: metaContent($, 'og:title'),
    price: rawPrice === undefined ? undefined : Number(String(rawPrice).replace(/[^\d.]/g, '')),
    id: metaContent($, 'product:retailer_item_id') ?? metaContent($, 'product:sku'),
    elements: {},
  };
}

// Merged rather than first-wins: a page may carry JSON-LD with a name but
// no price and Open Graph with the price, and taking the union of all four
// vocabularies is strictly better than picking one. Each field remembers
// which vocabulary supplied it, so the reported `source` stays truthful
// per-field instead of being flattened to whichever came first.
function readStructuredProduct($) {
  const readers = [
    () => {
      const [product] = readJsonLdProducts($);
      return product ? { layer: 'structured', source: 'json-ld', elements: {}, ...product } : null;
    },
    () => readMicrodataProduct($),
    () => readRdfaProduct($),
    () => readOpenGraphProduct($),
  ];

  const merged = { layer: 'structured', sources: {}, elements: {} };
  let found = false;
  for (const read of readers) {
    let got;
    try {
      got = read();
    } catch {
      got = null;
    }
    if (!got) continue;
    found = true;
    for (const key of ['name', 'price', 'id']) {
      const raw = got[key];
      const usable = raw !== undefined && raw !== null && raw !== '' && !(typeof raw === 'number' && Number.isNaN(raw));
      if (!usable || merged[key] !== undefined) continue;
      merged[key] = raw;
      merged.sources[key] = got.source;
      if (got.elements && got.elements[key]) merged.elements[key] = got.elements[key];
    }
  }
  return found ? merged : null;
}

// Any structured-data vocabulary declaring this page to be a single
// Product. Used both by the detectors and by the listing-page classifier.
function structuredProductEvidence($) {
  if (readJsonLdProducts($).length > 0) return 'json-ld';
  if (readMicrodataProduct($)) return 'microdata';
  if (readRdfaProduct($)) return 'rdfa';
  if ((metaContent($, 'og:type') || '').toLowerCase() === 'product') return 'open-graph';
  if (readOpenGraphProduct($)) return 'open-graph';
  return null;
}

// Smallest (most specific) element whose own text CONTAINS the target —
// smallest wins so a giant wrapping <body> never beats the actual label.
function findSmallestElementContaining($, predicate) {
  let best = null;
  let bestSize = Infinity;
  $('body *').each((_, el) => {
    const $el = $(el);
    const tag = tagNameOf($el);
    if (tag === 'script' || tag === 'style' || tag === undefined) return;
    const text = $el.text().trim();
    if (!text || !predicate(text)) return;
    const size = $el.find('*').length;
    if (size < bestSize) {
      best = $el;
      bestSize = size;
    }
  });
  return best;
}

function normalizeForCompare(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// "Most prominent" <h1>, server-side edition: prefer one anchored in the
// page's main content region (a banner/logo wordmark in a <header> must
// never beat the actual page title), then the longest text as the closest
// available proxy for visual prominence. Single-<h1> pages — the vast
// majority — behave exactly like the old `$('h1').first()`.
function findMostProminentHeading($) {
  let best = null;
  let bestScore = -1;
  $('h1').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (!text || isInsideChrome($el)) return;
    const inMain = $el.parents().is('main, article, [role="main"]') ? 1 : 0;
    const score = inMain * 10000 + Math.min(text.length, 9999);
    if (score > bestScore) {
      bestScore = score;
      best = $el;
    }
  });
  return best;
}

// =========================================================================
// PRIORITY 2 — Known e-commerce platform / naming-convention patterns
// =========================================================================
//
// Ordered most-specific-first within each list: an exact platform
// fingerprint (`.single_add_to_cart_button` is WooCommerce and nothing
// else) is tried before a generic substring convention
// (`[class*="add-to-cart"]`, which any theme might use for anything).
// Every list ends with the original pre-existing generic patterns so no
// page that used to be detected stops being detected.

const PRODUCT_NAME_PATTERNS = [
  // Shopify
  '.product__title', '.product-single__title', '.product-title', '.product__heading',
  // WooCommerce
  '.product_title', '.entry-title.product_title',
  // Magento / BigCommerce / generic storefronts
  '.page-title .base', '.productView-title', '#productTitle',
  // Test-id and data conventions
  '[data-testid*="product-title" i]', '[data-testid*="product-name" i]', '[data-product-title]',
  // Generic naming conventions
  '[class*="product-title" i]', '[class*="product_title" i]', '[class*="product-name" i]',
  '[class*="product_name" i]', '[id*="product-title" i]', '[id*="product-name" i]',
];

const PRODUCT_PRICE_PATTERNS = [
  // WooCommerce
  '.woocommerce-Price-amount', 'p.price .amount', '.summary .price',
  // Shopify
  '.price-item--regular', '.price__current', '.product__price', '.product-single__price',
  // Magento / BigCommerce
  '[data-price-type="finalPrice"]', '.productView-price',
  // Data conventions
  '[data-testid*="price" i]', '[data-product-price]', '[data-price]',
  // Generic naming conventions (the original pre-layer behavior lives here)
  '[class*="product-price" i]', '[class*="product_price" i]', '[class*="price" i]', '[id*="price" i]',
];

const ADD_TO_CART_PATTERNS = [
  // WooCommerce
  '.single_add_to_cart_button', 'button[name="add-to-cart"]',
  // Shopify
  'button[name="add"]', '.product-form__submit', '.product-form__cart-submit', '#AddToCart',
  // Magento / BigCommerce
  '#product-addtocart-button', '#form-action-addToCart',
  // Data conventions
  '[data-testid*="add-to-cart" i]', '[data-action="add-to-cart"]', '[data-add-to-cart]', '[data-button-action*="add-to-cart" i]',
  // Generic naming conventions
  '[class*="add-to-cart" i]', '[class*="add_to_cart" i]', '[class*="addtocart" i]',
  '[id*="add-to-cart" i]', '[id*="add_to_cart" i]', '[id*="addtocart" i]',
  '[class*="btn-cart" i]', '[class*="cart-btn" i]', '[class*="buy-now" i]', '[class*="btn-buy" i]',
];

// Patterns whose match is a platform fingerprint rather than a guess —
// these are as trustworthy as structured data, so they are not capped to
// 'medium' the way the generic naming conventions are.
const EXACT_PLATFORM_PATTERNS = new Set([
  '.woocommerce-Price-amount', '.single_add_to_cart_button', 'button[name="add-to-cart"]',
  'button[name="add"]', '.product-form__submit', '.product-form__cart-submit', '#AddToCart',
  '#product-addtocart-button', '#form-action-addToCart', '.product_title', '.product__title',
  '.product-single__title', '.price-item--regular', '.product-single__price',
  '.woocommerce-order-overview__order', '.woocommerce-order-overview__total',
]);

const ACTIONABLE = 'button, a, input[type="submit"], input[type="button"], [role="button"]';

// Walks a pattern list in priority order and returns the first element
// that BOTH matches a pattern and passes the caller's sanity check — a
// `.price` class with no number in it, or a "product-title" div holding a
// whole paragraph, is skipped rather than accepted just for matching.
function firstMatchingPattern($, patterns, isUsable, scope) {
  for (const pattern of patterns) {
    let matches;
    try {
      matches = scope ? scope.find(pattern) : $(pattern);
    } catch {
      continue; // a selector this cheerio build cannot parse — try the next
    }
    let picked = null;
    matches.each((_, el) => {
      if (picked) return;
      const $el = $(el);
      if (isUsable($el)) picked = $el;
    });
    if (picked) return { $el: picked, pattern, exact: EXACT_PLATFORM_PATTERNS.has(pattern) };
  }
  return null;
}

// =========================================================================
// PRIORITY 3 — Structural / textual heuristics
// =========================================================================

const PRICE_PATTERN = /[\d][\d,]*(?:\.\d+)?/;

// Currency-adjacent numbers, symbol-before or symbol-after, covering the
// symbols and ISO codes actually seen on the storefronts this feature
// targets. Deliberately requires the currency marker: a bare number is far
// too common (quantities, ratings, years) to treat as a price.
const CURRENCY_MARK = '[৳$€£₹¥₩₽₺฿]|Tk\\b|BDT|USD|EUR|GBP|INR|AUD|CAD|JPY|PKR|LKR|NPR|AED|SAR';
const CURRENCY_PRICE_PATTERN = new RegExp(
  `(?:${CURRENCY_MARK})\\s*[\\d][\\d,]*(?:\\.\\d+)?|[\\d][\\d,]*(?:\\.\\d+)?\\s*(?:${CURRENCY_MARK})`,
  'i'
);

const CHROME_TAGS = new Set(['nav', 'footer', 'header', 'aside', 'script', 'style', 'noscript']);

function isInsideChrome($el) {
  return $el.parents().toArray().some((el) => CHROME_TAGS.has(el.tagName?.toLowerCase()));
}

// The smallest element carrying a currency-marked number, ignoring page
// chrome (a footer "Free shipping over $50" line must never win over the
// actual product price in the page body).
function findCurrencyPriceElement($) {
  let best = null;
  let bestSize = Infinity;
  $('body *').each((_, el) => {
    const $el = $(el);
    const tag = tagNameOf($el);
    if (!tag || CHROME_TAGS.has(tag)) return;
    if (isInsideChrome($el)) return;
    const text = $el.text().trim();
    if (!text || text.length > 120) return;
    if (!CURRENCY_PRICE_PATTERN.test(text)) return;
    const size = $el.find('*').length;
    if (size < bestSize) {
      best = $el;
      bestSize = size;
    }
  });
  return best;
}

// Original pre-layer wording plus the other calls-to-action that mean the
// same thing on a product page. "Buy now"/"order now" are kept distinctly
// weaker signals than "add to cart" but they are still the single most
// reliable purchase-intent control when nothing else is present. The
// "add to card" variant is deliberate: storefronts in the wild ship this
// exact typo (a Django/Ogani-template fish market does), and it never
// means anything else on an actionable element.
const ADD_TO_CART_TEXT =
  /add.{0,2}to.{0,2}cart|single_add_to_cart|add.{0,2}to.{0,2}(bag|basket)|add.{0,2}to.{0,2}card|buy.{0,2}now|order.{0,2}now|purchase.{0,2}now/i;

function findAddToCartByText($) {
  let best = null;
  $(ACTIONABLE).each((_, el) => {
    if (best) return;
    const $el = $(el);
    const haystack = [
      $el.text(),
      $el.attr('class'),
      $el.attr('id'),
      $el.attr('name'),
      $el.attr('aria-label'),
      $el.attr('value'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (ADD_TO_CART_TEXT.test(haystack) || $el.attr('name') === 'add') best = $el;
  });
  return best;
}

// The single control this page offers for putting the product in a cart,
// resolved through P2 then P3. Shared by the detector and by the
// listing-page classifier, which uses its presence/position as evidence.
function findAddToCartElement($) {
  const platform = firstMatchingPattern($, ADD_TO_CART_PATTERNS, ($el) => {
    const tag = tagNameOf($el);
    if (!tag) return false;
    return $el.is(ACTIONABLE);
  });
  if (platform) return { $el: platform.$el, layer: 'platform', source: 'platform-pattern', exact: platform.exact };

  const byText = findAddToCartByText($);
  if (byText) return { $el: byText, layer: 'heuristic', source: 'button-text', exact: false };

  return null;
}

// =========================================================================
// Product detection
// =========================================================================

function detectProductName($, { hasOtherProductEvidence } = {}) {
  // --- P1: structured data ---
  const structured = readStructuredProduct($);
  if (structured?.name) {
    const $direct = structured.elements.name;
    const target = normalizeForCompare(String(structured.name));
    const $el =
      $direct && $direct.length
        ? $direct
        : findSmallestElementContaining($, (text) => normalizeForCompare(text) === target);
    if ($el) {
      const built = buildSelector($, $el);
      if (built) {
        return {
          value: built.selector,
          confidence: confidenceForSelector('structured', built.tier),
          source: structured.sources.name,
        };
      }
    }
  }

  // --- P2: platform / naming conventions ---
  const platform = firstMatchingPattern($, PRODUCT_NAME_PATTERNS, ($el) => {
    const text = $el.text().trim();
    return text.length >= 2 && text.length <= 200 && !/^[\d.,\s]+$/.test(text);
  });
  if (platform) {
    const built = buildSelector($, platform.$el);
    if (built) {
      return {
        value: built.selector,
        confidence: platform.exact ? 'high' : confidenceForSelector('platform', built.tier),
        source: 'platform-pattern',
      };
    }
  }

  // --- P3: the most prominent heading on the page ---
  const h1 = findMostProminentHeading($);
  if (h1 && h1.length && h1.text().trim()) {
    const built = buildSelector($, h1);
    if (built) return { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source: 'heading' };
  }

  // A page with no <h1> at all still has a "main heading" — but promoting
  // an <h2>/<h3> is only defensible once something ELSE on the page has
  // already confirmed this is a product (a price or an add-to-cart
  // control). Without that, a lower-level heading is just as likely to be
  // a section header. Django/Ogani-template shops title their product in
  // an <h3> with no other name markup anywhere.
  if (hasOtherProductEvidence) {
    const heading = $('[role="heading"][aria-level="1"], h2, h3').first();
    if (heading.length && heading.text().trim()) {
      const built = buildSelector($, heading);
      if (built) return { value: built.selector, confidence: 'low', source: 'heading' };
    }
  }

  return undefined;
}

const PRICE_REGEX_VALUE = '([\\d,]+\\.?\\d*)';

function detectProductPrice($) {
  // --- P1: structured data ---
  const structured = readStructuredProduct($);
  if (structured?.price !== undefined && Number.isFinite(structured.price)) {
    const $direct = structured.elements.price;
    const $el =
      $direct && $direct.length && PRICE_PATTERN.test($direct.text())
        ? $direct
        : findSmallestElementContaining($, (text) => {
            const match = PRICE_PATTERN.exec(text);
            return match !== null && Number(match[0].replace(/,/g, '')) === Number(structured.price);
          });
    if ($el) {
      const built = buildSelector($, $el);
      if (built) {
        return {
          value: built.selector,
          regex: PRICE_REGEX_VALUE,
          confidence: confidenceForSelector('structured', built.tier),
          source: structured.sources.price,
        };
      }
    }
  }

  // --- P2: platform / naming conventions ---
  // Requires BOTH a price-ish name AND a number in the text — either signal
  // alone is too noisy (a "price" class with no number, or a number with no
  // price-ish naming, e.g. a product count).
  const platform = firstMatchingPattern($, PRODUCT_PRICE_PATTERNS, ($el) => PRICE_PATTERN.test($el.text()));
  if (platform) {
    const built = buildSelector($, platform.$el);
    if (built) {
      return {
        value: built.selector,
        regex: PRICE_REGEX_VALUE,
        confidence: platform.exact ? 'high' : confidenceForSelector('platform', built.tier),
        source: platform.pattern.startsWith('[class*="price') || platform.pattern.startsWith('[id*="price')
          ? 'class-name'
          : 'platform-pattern',
      };
    }
  }

  // --- P3: a currency-marked number anywhere in the page body ---
  const $currency = findCurrencyPriceElement($);
  if ($currency) {
    const built = buildSelector($, $currency);
    if (built) {
      return { value: built.selector, regex: PRICE_REGEX_VALUE, confidence: 'low', source: 'currency-pattern' };
    }
  }

  return undefined;
}

const PRODUCT_ID_ATTR_PATTERNS = [
  ['[itemprop="productID"]', 'content'],
  ['[itemprop="sku"]', 'content'],
  ['[data-product-id]', 'data-product-id'],
  ['[data-product_id]', 'data-product_id'],
  ['[data-sku]', 'data-sku'],
  ['[data-variant-id]', 'data-variant-id'],
  ['[data-testid*="product-id" i]', 'data-product-id'],
];

// Hidden form inputs are how Shopify/WooCommerce add-to-cart forms carry
// the id when nothing else on the page does; modern WooCommerce instead
// stamps name/value onto the submit button itself, which reads identically.
const PRODUCT_ID_INPUT_PATTERNS = [
  ['input[name="product_id"]', 'value'],
  ['input[name="variant_id"]', 'value'],
  ['input[name="add-to-cart"]', 'value'],
  ['button[name="add-to-cart"]', 'value'],
  ['form[action*="cart" i] input[name="id"]', 'value'],
];

function detectProductId($, pathname) {
  // --- P1: structured data, anchored to the element that carries it ---
  const structured = readStructuredProduct($);
  if (structured?.id) {
    const target = String(structured.id);
    const withAttr = $('[data-product-id], [data-sku], [data-id], [data-variant-id]').filter((_, el) => {
      const $el = $(el);
      return (
        $el.attr('data-product-id') === target ||
        $el.attr('data-sku') === target ||
        $el.attr('data-id') === target ||
        $el.attr('data-variant-id') === target
      );
    });
    if (withAttr.length >= 1) {
      const $el = withAttr.first();
      const attrName =
        $el.attr('data-product-id') === target
          ? 'data-product-id'
          : $el.attr('data-sku') === target
            ? 'data-sku'
            : $el.attr('data-variant-id') === target
              ? 'data-variant-id'
              : 'data-id';
      const built = buildSelector($, $el);
      if (built) {
        return { source: 'selector', selector: `${built.selector}::attr(${attrName})`, confidence: 'high' };
      }
    }

    // The structured id may be rendered as visible text ("SKU: p-99")
    // rather than sitting in a data attribute.
    const $rendered = structured.elements.id;
    if ($rendered && $rendered.length) {
      const built = buildSelector($, $rendered);
      if (built) return { source: 'selector', selector: built.selector, confidence: 'high' };
    }
  }

  // --- P2: common markup conventions independent of structured data ---
  for (const [selector, attr] of [...PRODUCT_ID_ATTR_PATTERNS, ...PRODUCT_ID_INPUT_PATTERNS]) {
    let $el;
    try {
      $el = $(selector).first();
    } catch {
      continue;
    }
    if (!$el.length) continue;
    // Only accept an attribute that actually carries a value — a bare
    // `data-product-id` with nothing in it would extract to empty at runtime.
    const attrValue = attr === 'value' ? $el.attr('value') : $el.attr(attr) ?? $el.attr('content');
    if (!attrValue) continue;
    const built = buildSelector($, $el);
    if (built) {
      const realAttr = attr === 'value' ? 'value' : $el.attr(attr) ? attr : 'content';
      return { source: 'selector', selector: `${built.selector}::attr(${realAttr})`, confidence: 'medium' };
    }
  }

  // --- P3: no reliable DOM id — fall back to a URL param, but only when
  // the last path segment looks like an actual slug/id, not just a fixed
  // word (so "/products" alone never becomes a bogus ":id").
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && /[-\d]/.test(last)) {
    return { source: 'url', urlPatternOverride: `/${segments.slice(0, -1).concat(':id').join('/')}` };
  }

  return { source: 'url' };
}

function detectAddToCart($) {
  const found = findAddToCartElement($);
  if (!found) return undefined;
  const built = buildSelector($, found.$el);
  if (!built) return undefined;
  const confidence = found.exact
    ? 'high'
    : found.layer === 'platform'
      ? confidenceForSelector('platform', built.tier)
      : 'low';
  return { value: built.selector, confidence, source: found.source };
}

// =========================================================================
// Page-shape classification (why detection failed, not just that it did)
// =========================================================================
//
// Run BEFORE any field detection, on both the product and order pages —
// distinguishes "this really is the right kind of page, detection just
// found little" from "this is fundamentally the wrong page" (a listing
// grid, a login redirect, an empty JS shell), so the dashboard can say
// WHY nothing was found instead of a silent, unexplained empty result.

const LOGIN_TEXT = /\b(sign[\s-]?in|log[\s-]?in|login)\b/i;

function looksLikeLoginPage($) {
  if ($('form input[type="password"]').length > 0) return true;
  const title = $('title').first().text();
  const h1 = $('h1').first().text();
  return LOGIN_TEXT.test(title) || LOGIN_TEXT.test(h1);
}

// Visible text only — script/style content never counts as "the page has
// content," since that's exactly the JS-bundle text a client-rendered
// shell is full of even when the actual page is empty.
function visibleTextLength($) {
  const clone = $.root().clone();
  clone.find('script, style, noscript').remove();
  return clone.text().replace(/\s+/g, ' ').trim().length;
}

const MIN_VISIBLE_TEXT_LENGTH = 200;

// Groups elements that share a parent, tag and class signature — the
// "repeated structure" signal behind both listing-page detection and order
// line-item detection. `allowClasslessTags` covers table rows and list
// items, which repeat meaningfully even when a theme gives them no class
// at all (a plain <table><tr> order summary being the common case).
function groupRepeatedSiblings($, { allowClasslessTags } = {}) {
  const groups = new Map();
  $('body *').each((_, el) => {
    const $el = $(el);
    const tag = tagNameOf($el);
    if (!tag || tag === 'script' || tag === 'style') return;
    const classAttr = ($el.attr('class') || '').trim();
    if (!classAttr && !(allowClasslessTags && allowClasslessTags.has(tag))) return;
    const parent = $el.parent();
    if (!parent.length) return;
    const key = `${parent.get(0)}::${tag}::${classAttr}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  });
  return [...groups.values()];
}

// A product LISTING/grid page's signature: several elements sharing the
// same parent/tag/class, each wrapping both a link and a price. Two guards
// keep generic layout scaffolding from impersonating cards:
//
//   - COMPACTNESS: a real card is a small self-contained unit; a
//     `.container` wrapping a whole page section carries hundreds of
//     characters of inherited subtree text (this exact shape — five
//     sibling Bootstrap containers on a Django/Ogani-template shop — was
//     once accepted as a "grid" and got a genuine product page rejected).
//   - UNIFORMITY: true cards hold near-equal amounts of text (name +
//     price); mixed-purpose siblings like header/nav/footer containers
//     vary wildly in length.
const MAX_CARD_TEXT_LENGTH = 400;
const MAX_CARD_LENGTH_VARIANCE_RATIO = 6;

function findCardLikeGroups($) {
  return groupRepeatedSiblings($)
    .filter((elements) => {
      const lengths = elements.map((el) => $(el).text().replace(/\s+/g, ' ').trim().length);
      const shortest = Math.min(...lengths);
      return (
        shortest > 0 &&
        Math.max(...lengths) <= MAX_CARD_TEXT_LENGTH &&
        Math.max(...lengths) / shortest <= MAX_CARD_LENGTH_VARIANCE_RATIO
      );
    })
    .filter(
      (elements) =>
        elements.length >= 3 &&
        elements.every((el) => {
          const $el = $(el);
          return PRICE_PATTERN.test($el.text()) && $el.find('a').length > 0;
        })
    );
}

// A page with strong single-product evidence is never classified as a
// listing even if it also happens to show related/recommended products.
// Three independent kinds of evidence are accepted, in decreasing
// strength:
//
//   1. Any structured-data vocabulary declaring a Product (JSON-LD,
//      microdata, RDFa, og:type=product).
//   2. An add-to-cart control that sits OUTSIDE every repeated card — a
//      real category page puts its buttons inside the cards (or has none),
//      so a standalone one means the repeated grid is a "related products"
//      rail on a genuine product page. This is what previously made single
//      product pages carrying a recommendations grid get wrongly rejected.
//   3. A single <h1> that is likewise outside every card, paired with a
//      price outside every card.
//
// Set DETECTION_DEBUG=1 to print exactly how each rule evaluated for a
// given document (to stderr; silent in normal operation and in tests).
const DEBUG = process.env.DETECTION_DEBUG === '1';
function trace(...parts) {
  if (!DEBUG) return;
  console.error('[detection-trace]', ...parts);
}

function describeCardGroup($, elements) {
  const $first = $(elements[0]);
  const cls = String($first.attr('class') || '').split(/\s+/)[0] || '(no class)';
  return `${tagNameOf($first)}.${cls}×${elements.length}`;
}

function looksLikeListingPage($) {
  const structured = structuredProductEvidence($);
  trace('structured-product-evidence =', structured ?? 'none');
  if (structured) return false;

  const cardGroups = findCardLikeGroups($);
  trace('card-like groups =', cardGroups.length, cardGroups.map((els) => describeCardGroup($, els)));
  if (cardGroups.length === 0) return false;

  const cardElements = new Set(cardGroups.flat());
  const isOutsideEveryCard = ($el) => {
    if (!$el || !$el.length) return false;
    if (cardElements.has($el.get(0))) return false;
    return !$el.parents().toArray().some((el) => cardElements.has(el));
  };

  const cta = findAddToCartElement($);
  trace(
    'add-to-cart control =',
    cta ? `${cta.source} (${cta.$el.attr('class') || tagNameOf(cta.$el)}), outside-cards=${isOutsideEveryCard(cta.$el)}` : 'NONE FOUND'
  );
  if (cta && isOutsideEveryCard(cta.$el)) return false;

  const h1Count = $('h1').length;
  const $h1 = $('h1').first();
  const $price = findCurrencyPriceElement($);
  trace(
    'h1 count =', h1Count,
    '| h1 outside-cards =', $h1.length ? isOutsideEveryCard($h1) : 'n/a',
    '| currency price found =', Boolean($price && $price.length),
    '| price outside-cards =', $price && $price.length ? isOutsideEveryCard($price) : 'n/a',
    '| smallest price text =', JSON.stringify($price?.text()?.trim().slice(0, 50))
  );
  if (h1Count === 1 && $h1.length && isOutsideEveryCard($h1) && $price && $price.length && isOutsideEveryCard($price)) return false;

  trace('=> classified LISTING: repeated card-like group(s) present, no single-product evidence overrode them');
  return true;
}

// Broadened beyond the original four phrasings to the wording order
// confirmation pages actually use, including receipt/invoice framing.
const ORDER_SIGNAL_TEXT =
  /order\s*(id|no\.?|number|#|confirm|received|placed|complete|summary|details|total)|thank\s*you.*order|your\s*order|purchase\s*complete|payment\s*(received|confirmed|successful)|order\s*confirmation|invoice\s*(no\.?|number|#)|receipt/i;

function hasOrderSignals($) {
  return ORDER_SIGNAL_TEXT.test($('body').text());
}

// Shared by both product and order pages — login/js-shell are equally
// fatal for either. `subject` only changes the wording ("product data" vs
// "order data").
function classifyPageOrThrow($, subject) {
  if (looksLikeLoginPage($)) {
    throw new DetectionClassificationError(
      'login_required',
      `This page appears to require login or redirected to a sign-in page. The server can't see ${subject} here. Try "Test Detection" with the page's rendered HTML instead, or use the picker.`
    );
  }
  if (visibleTextLength($) < MIN_VISIBLE_TEXT_LENGTH) {
    throw new DetectionClassificationError(
      'js_rendered_empty',
      'This page appears to be JavaScript-rendered — the server received an almost-empty page. Try "Test Detection" with rendered HTML, or use the picker.'
    );
  }
}

function urlPatternFromPath(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/*';
  if (segments.length === 1) return `/${segments[0]}`;
  return `/${segments[0]}/*`;
}

export function detectProductConfig(html, pageUrl) {
  const $ = cheerio.load(html);
  const pathname = new URL(pageUrl).pathname;

  classifyPageOrThrow($, 'product data');
  if (looksLikeListingPage($)) {
    throw new DetectionClassificationError(
      'listing_page',
      'This looks like a product LISTING page, not a single product page. Please paste the URL of one specific product.'
    );
  }

  const result = {};

  result.productUrlPattern = { value: urlPatternFromPath(pathname), confidence: 'medium', source: 'url-structure' };

  const id = detectProductId($, pathname);
  if (id.source === 'selector') {
    result.productIdSource = { value: 'selector', confidence: id.confidence, source: 'derived' };
    result.productIdSelector = { value: id.selector, confidence: id.confidence, source: 'derived' };
  } else {
    result.productIdSource = { value: 'url', confidence: 'low', source: 'default' };
    if (id.urlPatternOverride) {
      result.productUrlPattern = { value: id.urlPatternOverride, confidence: 'medium', source: 'url-structure' };
    }
  }

  const price = detectProductPrice($);
  if (price) {
    result.productPriceSelector = { value: price.value, confidence: price.confidence, source: price.source };
    result.productPriceRegex = { value: price.regex, confidence: price.confidence, source: price.source };
  }

  const addToCart = detectAddToCart($);
  if (addToCart) result.addToCartSelector = addToCart;

  // Name is resolved last so its <h2> fallback can take the rest of the
  // page's findings into account (see detectProductName).
  const name = detectProductName($, { hasOtherProductEvidence: Boolean(price || addToCart) });
  if (name) result.productNameSelector = name;

  return result;
}

// =========================================================================
// Order detection
// =========================================================================

// `includeParent: false` stops the last candidate from escalating to the
// label's whole parent — for order ids that escalation once matched a stray
// year in distant page text ("…can be found in that email… © 2026 …") and
// fabricated a body-level selector; ids sit right beside their label or not
// at all. `siblingAnchored` likewise pins the next-sibling check to the
// START of the sibling's text, so a label paragraph followed by an
// unrelated footer can't donate ITS numbers to the id.
function findLabeledValue($, labelPattern, valuePattern, { includeParent = true, siblingAnchored = false } = {}) {
  const siblingPattern = siblingAnchored
    ? new RegExp(`^\\s*(?:${valuePattern.source})`, valuePattern.flags.replace('g', ''))
    : valuePattern;
  let best = null;
  $('body *').each((_, el) => {
    if (best) return;
    const $el = $(el);
    const tag = tagNameOf($el);
    if (tag === 'script' || tag === 'style' || tag === undefined) return;
    const ownText = $el
      .contents()
      .filter((_i, node) => node.type === 'text')
      .text()
      .trim();
    if (!ownText || !labelPattern.test(ownText)) return;

    // The value is usually right next to the label: same element, the
    // next sibling, or the parent's remaining text — checked in that
    // order, closest first.
    const candidates = [
      [$el, valuePattern],
      [$el.next(), siblingPattern],
      ...(includeParent ? [[$el.parent(), valuePattern]] : []),
    ];
    for (const [$candidate, pattern] of candidates) {
      if (!$candidate || !$candidate.length) continue;
      const text = $candidate.text().trim();
      const match = pattern.exec(text);
      if (match) {
        best = { $el: $candidate, match };
        return;
      }
    }
  });
  return best;
}

// Value-side patterns for label-proximity order-id lookup. The strict hex
// run covers uuid-style ids; the digit-word fallback (an id essentially
// always contains a digit) covers "Order number: 24817" and "#ORD-4417"
// shapes the hex-only pattern used to miss entirely.
const ORDER_ID_VALUE = /#?([a-f0-9-]{6,})/i;
const ORDER_ID_ANY_VALUE = /#?\s*([A-Za-z-]*\d[A-Za-z0-9_-]{2,})/;

const ORDER_ID_HEX_RUN = /[a-f0-9-]{6,}/i;
const ORDER_ID_DIGIT_WORD = /[A-Za-z-]*\d[A-Za-z0-9_-]*/;

const ORDER_ID_PATTERNS = [
  // WooCommerce / Shopify
  '.woocommerce-order-overview__order', '.os-order-number', '[data-order-number]', '[data-order-id]',
  // Data conventions
  '[data-testid*="order-number" i]', '[data-testid*="order-id" i]',
  // Generic naming conventions
  '[class*="order-number" i]', '[class*="order_number" i]', '[class*="order-id" i]',
  '[class*="order_id" i]', '[class*="orderid" i]', '[class*="confirmation-number" i]',
  '[id*="order-number" i]', '[id*="order_number" i]', '[id*="order-id" i]',
];

const ORDER_TOTAL_PATTERNS = [
  // WooCommerce / Shopify
  '.woocommerce-order-overview__total', '.payment-due__price', '.total-line--total .total-line__price',
  // Data conventions
  '[data-order-total]', '[data-testid*="order-total" i]', '[data-testid*="grand-total" i]',
  // Generic naming conventions
  '[class*="order-total" i]', '[class*="order_total" i]', '[class*="grand-total" i]',
  '[class*="grand_total" i]', '[id*="order-total" i]', '[id*="grand-total" i]',
];

// The regex handed to the SDK must actually extract the id out of the
// selected element's live text — derived from the matched text rather than
// hardcoded so a "#"-prefixed id and a bare uuid each get a regex that
// works on THEIR shape. A displayed "#" anchors the regex to itself:
// ids mixing letters and digits ("#ORD-20260819-4417") otherwise extract
// only partially, and unanchored templates capture the word "Order" from
// "Order number: …" instead of the number.
function orderIdRegexFor(text) {
  const hashed = /#\s*([A-Za-z0-9][A-Za-z0-9_-]*)/.exec(text);
  if (hashed) {
    return /^[a-f0-9-]+$/i.test(hashed[1]) ? '#([a-f0-9-]+)' : '#([A-Za-z0-9][A-Za-z0-9_-]+)';
  }
  if (ORDER_ID_HEX_RUN.test(text)) return '([a-f0-9-]{6,})';
  if (ORDER_ID_DIGIT_WORD.test(text)) return '([A-Za-z-]*\\d[A-Za-z0-9_-]*)';
  return undefined;
}

// Locates the visible element rendering a structured-data value, so an
// order id/total known from JSON-LD still yields a selector the runtime
// SDK can read. Returns nothing when the value is not rendered anywhere —
// never a selector pointing at markup that does not show it.
function elementRenderingValue($, rawValue) {
  const target = normalizeForCompare(String(rawValue));
  if (!target) return null;
  return findSmallestElementContaining($, (text) => normalizeForCompare(text).includes(target));
}

function detectOrderId($) {
  // --- P1: structured data ---
  const [order] = readJsonLdOrders($);
  if (order?.id) {
    const $el = elementRenderingValue($, order.id);
    if ($el) {
      const built = buildSelector($, $el);
      const regex = orderIdRegexFor($el.text().trim());
      if (built && regex) {
        const confidence = confidenceForSelector('structured', built.tier);
        return {
          selector: { value: built.selector, confidence, source: 'json-ld' },
          regex: { value: regex, confidence, source: 'json-ld' },
        };
      }
    }
  }

  // --- P2: platform / naming conventions ---
  const platform = firstMatchingPattern($, ORDER_ID_PATTERNS, ($el) => {
    const text = $el.text().trim();
    return text.length > 0 && text.length <= 200 && orderIdRegexFor(text) !== undefined;
  });
  if (platform) {
    const built = buildSelector($, platform.$el);
    const regex = orderIdRegexFor(platform.$el.text().trim());
    if (built && regex) {
      const confidence = platform.exact ? 'high' : confidenceForSelector('platform', built.tier);
      return {
        selector: { value: built.selector, confidence, source: 'platform-pattern' },
        regex: { value: regex, confidence, source: 'platform-pattern' },
      };
    }
  }

  // --- P3: label proximity ("Order ID: …") — the regex is derived from
  // the SAME element the selector points at, so the two always agree.
  const found = findLabeledValue($, /order\s*(id|number|#)/i, ORDER_ID_ANY_VALUE, {
    includeParent: false,
    siblingAnchored: true,
  });
  if (!found) return undefined;
  const built = buildSelector($, found.$el);
  const regex = orderIdRegexFor(found.$el.text().trim());
  if (!built || !regex) return undefined;
  return {
    selector: { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source: 'label-proximity' },
    regex: { value: regex, confidence: TIER_CONFIDENCE[built.tier], source: 'label-proximity' },
  };
}

function detectOrderTotal($) {
  // --- P1: structured data ---
  const [order] = readJsonLdOrders($);
  if (order?.total !== undefined && Number.isFinite(order.total)) {
    const $el = findSmallestElementContaining($, (text) => {
      const match = PRICE_PATTERN.exec(text);
      return match !== null && Number(match[0].replace(/,/g, '')) === Number(order.total);
    });
    if ($el) {
      const built = buildSelector($, $el);
      if (built) {
        const confidence = confidenceForSelector('structured', built.tier);
        return {
          selector: { value: built.selector, confidence, source: 'json-ld' },
          regex: { value: PRICE_REGEX_VALUE, confidence, source: 'json-ld' },
        };
      }
    }
  }

  // --- P2: platform / naming conventions ---
  const platform = firstMatchingPattern($, ORDER_TOTAL_PATTERNS, ($el) => {
    const text = $el.text().trim();
    return text.length <= 200 && PRICE_PATTERN.test(text);
  });
  if (platform) {
    const built = buildSelector($, platform.$el);
    if (built) {
      const confidence = platform.exact ? 'high' : confidenceForSelector('platform', built.tier);
      return {
        selector: { value: built.selector, confidence, source: 'platform-pattern' },
        regex: { value: PRICE_REGEX_VALUE, confidence, source: 'platform-pattern' },
      };
    }
  }

  // --- P3: label proximity. "grand total"/"order total" preferred over a
  // bare "total", which is more often a subtotal line.
  const strong = findLabeledValue($, /grand\s*total|order\s*total|amount\s*(paid|due)/i, PRICE_PATTERN);
  const found = strong || findLabeledValue($, /\btotal\b/i, PRICE_PATTERN);
  if (!found) return undefined;
  const built = buildSelector($, found.$el);
  if (!built) return undefined;
  const confidence = strong ? 'high' : TIER_CONFIDENCE[built.tier];
  return {
    selector: { value: built.selector, confidence, source: 'label-proximity' },
    regex: { value: PRICE_REGEX_VALUE, confidence, source: 'label-proximity' },
  };
}

// Known order line-item / order-summary row containers, tried before the
// generic repeated-structure scan.
const ORDER_ITEM_PATTERNS = [
  '.woocommerce-table--order-details tbody tr.order_item', 'tr.order_item',
  '.product-table .product', '.order-summary__section--product-list .product',
  '[data-order-item]', '[data-line-item]', '[data-testid*="line-item" i]',
  '.order-item', '.line-item', '.order-line', '.cart-item', '.product-line-item',
];

// Repeat containers that carry meaning even with no class attribute — a
// plain <tr> order-summary table is extremely common and was previously
// invisible to detection, which only ever grouped class-bearing siblings.
const CLASSLESS_REPEAT_TAGS = new Set(['tr', 'li']);

// Groups of >=2 siblings that each contain a price-like number (the
// strongest available signal that this is a repeating line-item list and
// not, say, a repeated nav menu); the largest such group wins.
function findRepeatedItemGroup($) {
  let best = null;
  for (const elements of groupRepeatedSiblings($, { allowClasslessTags: CLASSLESS_REPEAT_TAGS })) {
    if (elements.length < 2) continue;
    if (!elements.every((el) => PRICE_PATTERN.test($(el).text()))) continue;
    if (!best || elements.length > best.length) best = elements;
  }
  return best ? $(best) : null;
}

function buildGroupSelector($, $group) {
  const first = $group.eq(0);
  const tag = tagNameOf(first);
  const matchesGroup = (selector) => {
    try {
      const found = $(selector);
      return found.length === $group.length && found.toArray().every((el, i) => el === $group.get(i));
    } catch {
      return false;
    }
  };

  const classes = (first.attr('class') || '').split(/\s+/).filter(Boolean);
  for (let n = classes.length; n >= 1; n -= 1) {
    const combo = classes.slice(0, n).map(escapeIdent).join('.');
    const selector = tag ? `${tag}.${combo}` : `.${combo}`;
    if (matchesGroup(selector)) return selector;
  }

  // Class-less rows (a plain <tr>/<li> summary table): anchor the group to
  // a selector for its shared parent instead. Still verified to match the
  // group exactly, never emitted on faith.
  if (tag) {
    const parentBuilt = buildSelector($, first.parent());
    if (parentBuilt) {
      const selector = `${parentBuilt.selector} > ${tag}`;
      if (matchesGroup(selector)) return selector;
    }
    if (matchesGroup(tag)) return tag;
  }

  return null;
}

function detectOrderItems($) {
  // --- P2: a known line-item container class ---
  let $group = null;
  let layer = 'heuristic';
  for (const pattern of ORDER_ITEM_PATTERNS) {
    let matches;
    try {
      matches = $(pattern);
    } catch {
      continue;
    }
    if (matches.length >= 2 && matches.toArray().every((el) => PRICE_PATTERN.test($(el).text()))) {
      $group = matches;
      layer = 'platform';
      break;
    }
  }

  // --- P3: generic repeated-structure scan ---
  if (!$group) $group = findRepeatedItemGroup($);
  if (!$group) return undefined;

  const containerSelector = buildGroupSelector($, $group);
  if (!containerSelector) return undefined;

  const $first = $group.eq(0);
  const containerConfidence = layer === 'platform' ? 'medium' : 'medium';
  const source = layer === 'platform' ? 'platform-pattern' : 'repeated-structure';
  const result = {
    orderItemContainerSelector: { value: containerSelector, confidence: containerConfidence, source },
  };

  // Price: a LEAF element within this row whose text is a CLEAN number —
  // unlike the page-level total/product price, this schema has no
  // orderItemPriceRegex field (extractOrder's item loop reads
  // orderItemPriceSelector straight through parseNumber, with no regex
  // step to strip a surrounding currency symbol/label), so a selector
  // whose text still has "Tk"/"৳" attached would silently produce NaN at
  // runtime — only a match this clean is actually usable.
  const CLEAN_NUMBER = /^[\d,]+\.?\d*$/;
  let $price = null;
  $first.find('*').each((_, el) => {
    if ($price) return;
    const $el = $(el);
    if ($el.find('*').length === 0 && CLEAN_NUMBER.test($el.text().trim())) $price = $el;
  });
  if ($price) {
    const built = buildSelectorWithin($first, $price);
    if (built) {
      result.orderItemPriceSelector = { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source };
    }
  }

  // Name: the leaf element with the longest non-numeric text — the
  // product title is reliably the longest label in a line-item row.
  let $name = null;
  let longest = 0;
  $first.find('*').each((_, el) => {
    const $el = $(el);
    if ($el.find('*').length > 0) return; // leaves only
    const text = $el.text().trim();
    if (text && !/^[\d.,\s]+$/.test(text) && text.length > longest) {
      longest = text.length;
      $name = $el;
    }
  });
  if ($name) {
    const built = buildSelectorWithin($first, $name);
    if (built) result.orderItemNameSelector = { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source };
  }

  // Quantity: a leaf element whose entire text is a plain small integer —
  // same "no regex field to clean it up at runtime" constraint as price
  // above, so a "×2"-style prefix is deliberately NOT accepted here even
  // though it's a common display convention; it would just parse as NaN.
  let $qty = null;
  $first.find('*').each((_, el) => {
    if ($qty) return;
    const $el = $(el);
    if ($el.find('*').length > 0) return;
    if ($price && $el.get(0) === $price.get(0)) return;
    const text = $el.text().trim();
    if (/^\d{1,3}$/.test(text)) $qty = $el;
  });
  if ($qty) {
    const built = buildSelectorWithin($first, $qty);
    if (built) {
      result.orderItemQtySelector = { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source };
    }
  }

  // Id: the id very commonly lives directly ON the repeating row itself
  // (`<div class="order-item" data-product-id="...">`), not a descendant
  // — the runtime SDK's queryText() checks the container element itself
  // against the selector before searching its children (see
  // frontend/sdk/src/selectorTracking.js), so a plain attribute-presence
  // selector here is both correct and simplest: it matches every row via
  // that self-check, no per-instance uniqueness needed since this selector
  // is always queried relative to ONE already-matched container.
  const attrCandidates = ['data-product-id', 'data-sku', 'data-id', 'data-variant-id'];
  for (const attr of attrCandidates) {
    if ($first.attr(attr)) {
      result.orderItemIdSelector = { value: `[${attr}]::attr(${attr})`, confidence: 'high', source };
      break;
    }
  }
  if (!result.orderItemIdSelector) {
    // Fall back to searching for the id as a DESCENDANT of the row
    // instead (e.g. a nested link/element carrying the attribute).
    let $idEl = null;
    for (const attr of attrCandidates) {
      $idEl = $first.find(`[${attr}]`).first();
      if ($idEl.length) {
        const built = buildSelectorWithin($first, $idEl);
        if (built) {
          result.orderItemIdSelector = {
            value: `${built.selector}::attr(${attr})`,
            confidence: TIER_CONFIDENCE[built.tier],
            source,
          };
        }
        break;
      }
    }
  }

  return result;
}

export function detectOrderConfig(html, pageUrl, websiteCurrency) {
  const $ = cheerio.load(html);
  const pathname = new URL(pageUrl).pathname;

  classifyPageOrThrow($, 'order data');

  const result = {};

  result.orderTriggerUrlPattern = { value: urlPatternFromPath(pathname), confidence: 'medium', source: 'url-structure' };

  // Sourced from the website's own settings, never guessed from page
  // text — see the module header comment and the plan's rationale: this
  // is strictly more reliable than scraping a currency symbol, and money
  // is never worth guessing.
  if (websiteCurrency) {
    result.orderCurrency = { value: websiteCurrency, confidence: 'high', source: 'website-settings' };
  }

  const id = detectOrderId($);
  if (id) {
    result.orderIdSelector = id.selector;
    result.orderIdRegex = id.regex;
  }

  const total = detectOrderTotal($);
  if (total) {
    result.orderTotalSelector = total.selector;
    result.orderTotalRegex = total.regex;
  }

  // Neither a real id/total nor even generic order-ish wording anywhere
  // on the page — this is not "an order page detection did poorly on,"
  // it's the wrong page entirely (a generic/login/listing page that
  // slipped past the checks above). Checked AFTER attempting real
  // detection, not instead of it — a page using unusual markup for a
  // genuine order id/total should never trip this just for lacking the
  // literal word "order" nearby.
  if (!id && !total && !hasOrderSignals($)) {
    throw new DetectionClassificationError(
      'order_signals_missing',
      "This page doesn't show order/purchase confirmation details (no order number, total, or confirmation text found). Please paste the URL of an actual order confirmation / thank-you page."
    );
  }

  const items = detectOrderItems($);
  if (items) Object.assign(result, items);

  return result;
}

export { DetectionClassificationError };
