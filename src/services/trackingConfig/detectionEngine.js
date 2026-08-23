import * as cheerio from 'cheerio';

// Pure, no-I/O heuristic analysis of a single page's HTML for Auto Detect
// Configuration. Every function here returns either a usable
// `{ value, confidence, source }` or nothing at all — NEVER a guessed
// selector that merely "looks right" (§10's explicit requirement). Every
// selector this module hands back has already been verified, by actually
// querying the parsed document, to match exactly what it's supposed to
// match — the same discipline `frontend/src/utils/selectorGenerator.ts`
// already established for the client-side picker, ported here to
// cheerio's query engine so it works against a server-fetched document.
//
// This module never touches the network or the database — it is handed
// already-fetched HTML strings by trackingConfigDetection.service.js,
// which is what keeps it trivially unit-testable with plain HTML fixtures.

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
// selectorGenerator.ts already uses client-side, ported to cheerio.
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

// selectorGenerator.ts's tiers are a strict ordinal preference, not a
// numeric score — the same ordinal is reused here, mapped onto this
// feature's high/medium/low vocabulary so the dashboard can show a single
// consistent confidence badge regardless of which detector produced it.
const TIER_CONFIDENCE = { id: 'high', attribute: 'high', class: 'medium', structural: 'low' };

// --- JSON-LD / microdata ground truth ---------------------------------
//
// Structured data is authored specifically to be machine-read, so when
// present it is the most reliable source of TRUTH about a value — but it
// is not itself a queryable CSS location the SDK's selector_regex mode can
// read at runtime (that's what the independent 'jsonld' detection mode is
// for). Its real job here is different: it tells us the actual text to go
// find on the visible page, so the selector we build points at a REAL,
// verified, rendered element rather than a guess.

function readJsonLdProducts($) {
  const products = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    const nodes = Array.isArray(parsed) ? parsed : parsed['@graph'] ? parsed['@graph'] : [parsed];
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const type = node['@type'];
      const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
      if (!isProduct) continue;
      const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      products.push({
        name: typeof node.name === 'string' ? node.name : undefined,
        id: node.sku || node.productID || node.gtin13 || node.mpn,
        price: offer && offer.price !== undefined ? Number(offer.price) : undefined,
      });
    }
  });
  return products;
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

// --- Product detection ---------------------------------------------------

function detectProductName($) {
  const [truth] = readJsonLdProducts($);
  if (truth?.name) {
    const target = normalizeForCompare(truth.name);
    const $el = findSmallestElementContaining($, (text) => normalizeForCompare(text) === target);
    if ($el) {
      const built = buildSelector($, $el);
      if (built) return { value: built.selector, confidence: 'high', source: 'json-ld' };
    }
  }

  const h1 = $('h1').first();
  if (h1.length && h1.text().trim()) {
    const built = buildSelector($, h1);
    if (built) return { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source: 'heading' };
  }

  return undefined;
}

const PRICE_PATTERN = /[\d][\d,]*(?:\.\d+)?/;

function detectProductPrice($) {
  const [truth] = readJsonLdProducts($);
  if (truth?.price !== undefined && Number.isFinite(truth.price)) {
    const priceStr = String(truth.price);
    const $el = findSmallestElementContaining($, (text) => {
      const match = PRICE_PATTERN.exec(text);
      return match !== null && Number(match[0].replace(/,/g, '')) === Number(priceStr);
    });
    if ($el) {
      const built = buildSelector($, $el);
      if (built) return { value: built.selector, regex: '([\\d,]+\\.?\\d*)', confidence: 'high', source: 'json-ld' };
    }
  }

  // Fallback: an element whose class/id names it as a price AND whose text
  // actually contains a number — either signal alone is too noisy (a
  // "price" class with no number, or a number with no price-ish naming,
  // e.g. a product count).
  let candidate = null;
  $('[class*="price" i], [id*="price" i]').each((_, el) => {
    if (candidate) return;
    const $el = $(el);
    if (PRICE_PATTERN.test($el.text())) candidate = $el;
  });
  if (candidate) {
    const built = buildSelector($, candidate);
    if (built) return { value: built.selector, regex: '([\\d,]+\\.?\\d*)', confidence: 'medium', source: 'class-name' };
  }

  return undefined;
}

function detectProductId($, pathname) {
  const [truth] = readJsonLdProducts($);
  if (truth?.id) {
    const target = String(truth.id);
    const withAttr = $('[data-product-id], [data-sku], [data-id]').filter((_, el) => {
      const $el = $(el);
      return (
        $el.attr('data-product-id') === target || $el.attr('data-sku') === target || $el.attr('data-id') === target
      );
    });
    if (withAttr.length >= 1) {
      const $el = withAttr.first();
      const attrName = $el.attr('data-product-id') === target ? 'data-product-id' : $el.attr('data-sku') === target ? 'data-sku' : 'data-id';
      const built = buildSelector($, $el);
      if (built) {
        return {
          source: 'selector',
          selector: `${built.selector}::attr(${attrName})`,
          confidence: 'high',
        };
      }
    }
  }

  // Common markup conventions independent of JSON-LD.
  const attrCandidates = [
    ['[itemprop="productID"]', 'content'],
    ['[itemprop="sku"]', 'content'],
    ['[data-product-id]', 'data-product-id'],
    ['[data-sku]', 'data-sku'],
  ];
  for (const [selector, attr] of attrCandidates) {
    const $el = $(selector).first();
    if ($el.length) {
      const built = buildSelector($, $el);
      if (built) return { source: 'selector', selector: `${built.selector}::attr(${attr})`, confidence: 'medium' };
    }
  }

  // No reliable DOM id — fall back to a URL param, but only when the last
  // path segment looks like an actual slug/id, not just a fixed word (so
  // "/products" alone never becomes a bogus ":id").
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && /[-\d]/.test(last)) {
    return { source: 'url', urlPatternOverride: `/${segments.slice(0, -1).concat(':id').join('/')}` };
  }

  return { source: 'url' };
}

function detectAddToCart($) {
  const CANDIDATES = 'button, a, input[type="submit"], input[type="button"]';
  let best = null;
  $(CANDIDATES).each((_, el) => {
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
    if (/add.{0,2}to.{0,2}cart|single_add_to_cart/.test(haystack) || $el.attr('name') === 'add') {
      best = $el;
    }
  });
  if (!best) return undefined;
  const built = buildSelector($, best);
  if (!built) return undefined;
  return { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source: 'button-text' };
}

// --- Page-shape classification --------------------------------------------
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

// A product LISTING/grid page's signature: several elements sharing the
// same parent/tag/class, each wrapping both a link and a price — the same
// "repeated structure" signal detectOrderItems already uses for order
// line items, applied here to catch a category page before it gets
// mistaken for one single product. A page with strong single-product
// evidence (JSON-LD Product, or an explicit og:type=product tag) is never
// classified as a listing even if it also happens to show related/
// recommended products elsewhere on the page.
function looksLikeListingPage($) {
  if (readJsonLdProducts($).length > 0) return false;
  if (($('meta[property="og:type"]').attr('content') || '').toLowerCase() === 'product') return false;

  const groups = new Map();
  $('body *').each((_, el) => {
    const $el = $(el);
    const tag = tagNameOf($el);
    if (!tag || tag === 'script' || tag === 'style') return;
    const classAttr = ($el.attr('class') || '').trim();
    if (!classAttr) return;
    const parent = $el.parent();
    if (!parent.length) return;
    const key = `${parent.get(0)}::${tag}::${classAttr}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  });

  for (const elements of groups.values()) {
    if (elements.length < 3) continue;
    const cardLike = elements.every((el) => {
      const $el = $(el);
      return PRICE_PATTERN.test($el.text()) && $el.find('a').length > 0;
    });
    if (cardLike) return true;
  }
  return false;
}

const ORDER_SIGNAL_TEXT = /order\s*(id|number|#|confirm)|thank\s*you.*order|purchase\s*complete|order\s*summary/i;

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

  const name = detectProductName($);
  if (name) result.productNameSelector = name;

  const price = detectProductPrice($);
  if (price) {
    result.productPriceSelector = { value: price.value, confidence: price.confidence, source: price.source };
    result.productPriceRegex = { value: price.regex, confidence: price.confidence, source: price.source };
  }

  const addToCart = detectAddToCart($);
  if (addToCart) result.addToCartSelector = addToCart;

  return result;
}

// --- Order detection -------------------------------------------------------

function findLabeledValue($, labelPattern, valuePattern) {
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
    const candidates = [$el, $el.next(), $el.parent()];
    for (const $candidate of candidates) {
      if (!$candidate || !$candidate.length) continue;
      const text = $candidate.text().trim();
      const match = valuePattern.exec(text);
      if (match) {
        best = { $el: $candidate, match };
        return;
      }
    }
  });
  return best;
}

function detectOrderId($) {
  const found = findLabeledValue($, /order\s*(id|number|#)/i, /#?([a-f0-9-]{6,})/i);
  if (!found) return undefined;
  const built = buildSelector($, found.$el);
  if (!built) return undefined;
  const regex = found.match[0].startsWith('#') ? '#([a-f0-9-]+)' : '([a-f0-9-]{6,})';
  return {
    selector: { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source: 'label-proximity' },
    regex: { value: regex, confidence: TIER_CONFIDENCE[built.tier], source: 'label-proximity' },
  };
}

function detectOrderTotal($) {
  // "grand total"/"order total" preferred over a bare "total", which is
  // more often a subtotal line.
  const strong = findLabeledValue($, /grand\s*total|order\s*total/i, PRICE_PATTERN);
  const found = strong || findLabeledValue($, /\btotal\b/i, PRICE_PATTERN);
  if (!found) return undefined;
  const built = buildSelector($, found.$el);
  if (!built) return undefined;
  const confidence = strong ? 'high' : TIER_CONFIDENCE[built.tier];
  return {
    selector: { value: built.selector, confidence, source: 'label-proximity' },
    regex: { value: '([\\d,]+\\.?\\d*)', confidence, source: 'label-proximity' },
  };
}

// Groups elements sharing the same parent + tag + exact class string,
// keeps groups of >=2 that each contain a price-like number (the
// strongest available signal that this is a repeating line-item list and
// not, say, a repeated nav menu), and prefers the largest such group.
function findRepeatedItemGroup($) {
  const groups = new Map();
  $('body *').each((_, el) => {
    const $el = $(el);
    const tag = tagNameOf($el);
    if (!tag || tag === 'script' || tag === 'style') return;
    const classAttr = ($el.attr('class') || '').trim();
    if (!classAttr) return;
    const parent = $el.parent();
    if (!parent.length) return;
    const key = `${parent.get(0)}::${tag}::${classAttr}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  });

  let best = null;
  for (const elements of groups.values()) {
    if (elements.length < 2) continue;
    const allHavePrice = elements.every((el) => PRICE_PATTERN.test($(el).text()));
    if (!allHavePrice) continue;
    if (!best || elements.length > best.length) best = elements;
  }
  return best ? $(best) : null;
}

function buildGroupSelector($, $group) {
  const first = $group.eq(0);
  const tag = tagNameOf(first);
  const classes = (first.attr('class') || '').split(/\s+/).filter(Boolean);
  for (let n = classes.length; n >= 1; n -= 1) {
    const combo = classes.slice(0, n).map(escapeIdent).join('.');
    const selector = tag ? `${tag}.${combo}` : `.${combo}`;
    try {
      const found = $(selector);
      if (found.length === $group.length && found.toArray().every((el, i) => el === $group.get(i))) {
        return selector;
      }
    } catch {
      // invalid selector — try the next, shorter class combination
    }
  }
  return null;
}

function detectOrderItems($) {
  const $group = findRepeatedItemGroup($);
  if (!$group) return undefined;
  const containerSelector = buildGroupSelector($, $group);
  if (!containerSelector) return undefined;

  const $first = $group.eq(0);
  const result = { orderItemContainerSelector: { value: containerSelector, confidence: 'medium', source: 'repeated-structure' } };

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
      result.orderItemPriceSelector = { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source: 'repeated-structure' };
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
    if (built) result.orderItemNameSelector = { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source: 'repeated-structure' };
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
      result.orderItemQtySelector = { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source: 'repeated-structure' };
    }
  }

  // Id: the id very commonly lives directly ON the repeating row itself
  // (`<div class="order-item" data-product-id="...">`), not a descendant
  // — the runtime SDK's queryText() checks the container element itself
  // against the selector before searching its children (see
  // frontend/sdk/src/selectorTracking.ts), so a plain attribute-presence
  // selector here is both correct and simplest: it matches every row via
  // that self-check, no per-instance uniqueness needed since this selector
  // is always queried relative to ONE already-matched container.
  const attrCandidates = ['data-product-id', 'data-sku', 'data-id'];
  for (const attr of attrCandidates) {
    if ($first.attr(attr)) {
      result.orderItemIdSelector = { value: `[${attr}]::attr(${attr})`, confidence: 'high', source: 'repeated-structure' };
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
            source: 'repeated-structure',
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
