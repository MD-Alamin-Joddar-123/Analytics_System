import * as cheerio from 'cheerio';


const SEMANTIC_ATTRS = ['data-testid', 'data-test', 'data-qa', 'itemprop', 'name'];
const MAX_CLASSES = 4;
const MAX_STRUCTURAL_DEPTH = 4;

class DetectionClassificationError extends Error {
  constructor(reason, message, partialFields) {
    super(message);
    this.name = 'DetectionClassificationError';
    this.reason = reason;
    this.partialFields = partialFields;
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

function buildSelectorCascade($el, matchFn, { allowStructural = true } = {}) {
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

  if (!allowStructural) return null;

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

function ownSelectorCandidates($el) {
  const candidates = [];
  const id = $el.attr('id');
  if (id) candidates.push(`#${escapeIdent(id)}`);

  for (const attr of SEMANTIC_ATTRS) {
    const value = $el.attr(attr);
    if (value) candidates.push(`[${attr}="${value}"]`);
  }

  const tag = tagNameOf($el);
  const classes = ($el.attr('class') || '').split(/\s+/).filter(Boolean).slice(0, MAX_CLASSES);
  for (let n = classes.length; n >= 1; n -= 1) {
    const combo = classes.slice(0, n).map(escapeIdent).join('.');
    candidates.push(tag ? `${tag}.${combo}` : `.${combo}`);
  }
  if (tag) candidates.push(tag);

  return candidates;
}

function firstMatchIs($, selector, $el) {
  try {
    const found = $(selector);
    return found.length > 0 && found.get(0) === $el.get(0);
  } catch {
    return false;
  }
}

const MAX_SCOPE_DEPTH = 6;

function buildFirstMatchSelector($, $el) {
  const named = buildSelectorCascade($el, (selector, el) => isUniqueMatch($, selector, el), {
    allowStructural: false,
  });
  if (named) return { ...named, unique: true };

  const ownCandidates = ownSelectorCandidates($el);
  for (const own of ownCandidates) {
    if (firstMatchIs($, own, $el)) return { selector: own, tier: 'class', unique: false };
  }

  let $ancestor = $el.parent();
  for (let depth = 0; depth < MAX_SCOPE_DEPTH && $ancestor.length; depth += 1) {
    const tag = tagNameOf($ancestor);
    if (!tag || tag === 'html') break;
    for (const ancestorSelector of ownSelectorCandidates($ancestor)) {
      for (const own of ownCandidates) {
        const selector = `${ancestorSelector} ${own}`;
        if (firstMatchIs($, selector, $el)) return { selector, tier: 'class', unique: false };
      }
    }
    $ancestor = $ancestor.parent();
  }

  const structural = buildSelector($, $el);
  return structural ? { ...structural, unique: true } : null;
}

function buildFirstMatchSelectorWithin($, $scope, $el) {
  const named = buildSelectorCascade($el, (selector, el) => isUniqueWithin($scope, selector, el), {
    allowStructural: false,
  });
  if (named) return named;

  const firstWithin = (selector) => {
    try {
      const found = $scope.find(selector);
      return found.length > 0 && found.get(0) === $el.get(0);
    } catch {
      return false;
    }
  };

  const ownCandidates = ownSelectorCandidates($el);
  const tag = tagNameOf($el);
  const namedOwn = ownCandidates.filter((candidate) => candidate !== tag);

  for (const own of namedOwn) {
    if (firstWithin(own)) return { selector: own, tier: 'class' };
  }

  let $ancestor = $el.parent();
  for (let depth = 0; depth < MAX_SCOPE_DEPTH && $ancestor.length; depth += 1) {
    if ($ancestor.get(0) === $scope.get(0)) break;
    for (const ancestorSelector of ownSelectorCandidates($ancestor)) {
      for (const own of ownCandidates) {
        const selector = `${ancestorSelector} ${own}`;
        if (firstWithin(selector)) return { selector, tier: 'class' };
      }
    }
    $ancestor = $ancestor.parent();
  }

  if (tag && firstWithin(tag)) return { selector: tag, tier: 'class' };

  return buildSelectorWithin($scope, $el);
}

const TIER_CONFIDENCE = { id: 'high', attribute: 'high', class: 'medium', structural: 'low' };

const LAYER_CONFIDENCE = { structured: 'high', platform: 'medium', heuristic: 'low' };

const CONFIDENCE_ORDER = ['low', 'medium', 'high'];

function lowerOf(a, b) {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

function confidenceFor(layer, tier) {
  const base = LAYER_CONFIDENCE[layer];
  return tier === 'structural' ? lowerOf(base, 'medium') === base ? base : 'medium' : base;
}

function confidenceForSelector(layer, tier) {
  const base = LAYER_CONFIDENCE[layer];
  if (tier !== 'structural') return base;
  const index = CONFIDENCE_ORDER.indexOf(base);
  return CONFIDENCE_ORDER[Math.max(0, index - 1)];
}


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

function structuredProductEvidence($) {
  if (readJsonLdProducts($).length > 0) return 'json-ld';
  if (readMicrodataProduct($)) return 'microdata';
  if (readRdfaProduct($)) return 'rdfa';
  if ((metaContent($, 'og:type') || '').toLowerCase() === 'product') return 'open-graph';
  if (readOpenGraphProduct($)) return 'open-graph';
  return null;
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isInsideBreadcrumb($el) {
  if (/breadcrumb/i.test($el.attr('class') || '')) return true;
  return $el.parents().toArray().some((el) => /breadcrumb/i.test(el.attribs?.class || ''));
}

function findSmallestElementContaining($, predicate) {
  let best = null;
  let bestSize = Infinity;
  let bestIsHeading = false;
  $('body *').each((_, el) => {
    const $el = $(el);
    const tag = tagNameOf($el);
    if (tag === 'script' || tag === 'style' || tag === undefined) return;
    if (CHROME_TAGS.has(tag) || isInsideChrome($el) || isInsideBreadcrumb($el)) return;
    const text = $el.text().trim();
    if (!text || !predicate(text)) return;

    const size = $el.find('*').length;
    const isHeading = HEADING_TAGS.has(tag);
    const better = size < bestSize || (size === bestSize && isHeading && !bestIsHeading);
    if (better) {
      best = $el;
      bestSize = size;
      bestIsHeading = isHeading;
    }
  });
  return best;
}

function normalizeForCompare(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

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


const PRODUCT_NAME_PATTERNS = [
  '.product__title', '.product-single__title', '.product-title', '.product__heading',
  '.product_title', '.entry-title.product_title',
  '.page-title .base', '.productView-title', '#productTitle',
  '[data-testid*="product-title" i]', '[data-testid*="product-name" i]', '[data-product-title]',
  '[class*="product-title" i]', '[class*="product_title" i]', '[class*="product-name" i]',
  '[class*="product_name" i]', '[id*="product-title" i]', '[id*="product-name" i]',
];

const PRODUCT_PRICE_PATTERNS = [
  '.woocommerce-Price-amount', 'p.price .amount', '.summary .price',
  '.price-item--regular', '.price__current', '.product__price', '.product-single__price',
  '[data-price-type="finalPrice"]', '.productView-price',
  '[data-testid*="price" i]', '[data-product-price]', '[data-price]',
  '[class*="product-price" i]', '[class*="product_price" i]', '[class*="price" i]', '[id*="price" i]',
];

const ADD_TO_CART_PATTERNS = [
  '.single_add_to_cart_button', 'button[name="add-to-cart"]',
  'button[name="add"]', '.product-form__submit', '.product-form__cart-submit', '#AddToCart',
  '#product-addtocart-button', '#form-action-addToCart',
  '[data-testid*="add-to-cart" i]', '[data-action="add-to-cart"]', '[data-add-to-cart]', '[data-button-action*="add-to-cart" i]',
  '[class*="add-to-cart" i]', '[class*="add_to_cart" i]', '[class*="addtocart" i]',
  '[id*="add-to-cart" i]', '[id*="add_to_cart" i]', '[id*="addtocart" i]',
  '[class*="btn-cart" i]', '[class*="cart-btn" i]', '[class*="buy-now" i]', '[class*="btn-buy" i]',
];

const EXACT_PLATFORM_PATTERNS = new Set([
  '.woocommerce-Price-amount', '.single_add_to_cart_button', 'button[name="add-to-cart"]',
  'button[name="add"]', '.product-form__submit', '.product-form__cart-submit', '#AddToCart',
  '#product-addtocart-button', '#form-action-addToCart', '.product_title', '.product__title',
  '.product-single__title', '.price-item--regular', '.product-single__price',
  '.woocommerce-order-overview__order', '.woocommerce-order-overview__total',
]);

const ACTIONABLE = 'button, a, input[type="submit"], input[type="button"], [role="button"]';

function firstMatchingPattern($, patterns, isUsable, scope) {
  for (const pattern of patterns) {
    let matches;
    try {
      matches = scope ? scope.find(pattern) : $(pattern);
    } catch {
      continue;
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


const PRICE_PATTERN = /[\d][\d,]*(?:\.\d+)?/;

const CURRENCY_MARK = '[৳$€£₹¥₩₽₺฿]|Tk\\b|BDT|USD|EUR|GBP|INR|AUD|CAD|JPY|PKR|LKR|NPR|AED|SAR';
const CURRENCY_PRICE_PATTERN = new RegExp(
  `(?:${CURRENCY_MARK})\\s*[\\d][\\d,]*(?:\\.\\d+)?|[\\d][\\d,]*(?:\\.\\d+)?\\s*(?:${CURRENCY_MARK})`,
  'i'
);

const CHROME_TAGS = new Set(['nav', 'footer', 'header', 'aside', 'script', 'style', 'noscript']);

function isInsideChrome($el) {
  return $el.parents().toArray().some((el) => CHROME_TAGS.has(el.tagName?.toLowerCase()));
}

function findCurrencyPriceElement($, $scope) {
  let best = null;
  let bestSize = Infinity;
  const candidates = $scope && $scope.length ? $scope.find('*') : $('body *');
  candidates.each((_, el) => {
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

const CURRENCY_MARK_TO_ISO = {
  '৳': 'BDT',
  Tk: 'BDT',
  BDT: 'BDT',
  EUR: 'EUR',
  '€': 'EUR',
  GBP: 'GBP',
  '£': 'GBP',
  INR: 'INR',
  '₹': 'INR',
  AUD: 'AUD',
  CAD: 'CAD',
  JPY: 'JPY',
  PKR: 'PKR',
  LKR: 'LKR',
  NPR: 'NPR',
  AED: 'AED',
  SAR: 'SAR',
  '₩': 'KRW',
  '₽': 'RUB',
  '₺': 'TRY',
  '฿': 'THB',
};
const AMBIGUOUS_CURRENCY_MARKS = new Set(['$', '¥']);
const CURRENCY_MARKER_REGEX = /৳|Tk\b|BDT|USD|EUR|GBP|INR|AUD|CAD|JPY|PKR|LKR|NPR|AED|SAR|[€£₹₩₽₺฿$¥]/gi;

function resolveCurrencyFromText(text) {
  const isos = new Set();
  for (const match of String(text).matchAll(CURRENCY_MARKER_REGEX)) {
    const mark = match[0];
    let iso = CURRENCY_MARK_TO_ISO[mark];
    if (iso === undefined && !AMBIGUOUS_CURRENCY_MARKS.has(mark)) iso = CURRENCY_MARK_TO_ISO[mark.toUpperCase()];
    if (!iso) return undefined;
    isos.add(iso);
  }
  return isos.size === 1 ? [...isos][0] : undefined;
}

function detectOrderCurrency($, websiteCurrency, total) {
  if (total?.selector?.value) {
    const fromTotal = resolveCurrencyFromText($(total.selector.value).first().text());
    if (fromTotal) return { value: fromTotal, confidence: 'high', source: 'order-page' };
  }
  const $price = findCurrencyPriceElement($);
  if ($price) {
    const fromPrice = resolveCurrencyFromText($price.text());
    if (fromPrice) return { value: fromPrice, confidence: 'high', source: 'order-page' };
  }
  if (websiteCurrency) return { value: websiteCurrency, confidence: 'high', source: 'website-settings' };
  return undefined;
}

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


function detectProductName($, { hasOtherProductEvidence } = {}) {
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

  const h1 = findMostProminentHeading($);
  if (h1 && h1.length && h1.text().trim()) {
    const built = buildSelector($, h1);
    if (built) return { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source: 'heading' };
  }

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

function findProductTitleElement($) {
  const platform = firstMatchingPattern($, PRODUCT_NAME_PATTERNS, ($el) => {
    const text = $el.text().trim();
    return text.length >= 2 && text.length <= 200 && !/^[\d.,\s]+$/.test(text);
  });
  if (platform) return platform.$el;
  const h1 = $('h1').first();
  return h1.length && h1.text().trim() ? h1 : undefined;
}

function productSummaryScope($, $title, $cta) {
  if (!$title || !$title.length || !$cta || !$cta.length) return undefined;
  const ctaAncestors = new Set($cta.parents().toArray());
  const common = $title.parents().toArray().find((el) => ctaAncestors.has(el));
  if (!common) return undefined;
  const tag = tagNameOf($(common));
  if (tag === 'body' || tag === 'html' || tag === undefined) return undefined;
  return $(common);
}

function detectProductPrice($, $scope) {
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

  const isPriceLike = ($el) => PRICE_PATTERN.test($el.text());
  const platform =
    ($scope ? firstMatchingPattern($, PRODUCT_PRICE_PATTERNS, isPriceLike, $scope) : null) ??
    firstMatchingPattern($, PRODUCT_PRICE_PATTERNS, isPriceLike);
  if (platform) {
    const built = buildFirstMatchSelector($, platform.$el);
    if (built) {
      const base = confidenceForSelector(platform.exact ? 'structured' : 'platform', built.tier);
      return {
        value: built.selector,
        regex: PRICE_REGEX_VALUE,
        confidence: built.unique ? base : lowerOf(base, 'medium'),
        source: platform.pattern.startsWith('[class*="price') || platform.pattern.startsWith('[id*="price')
          ? 'class-name'
          : 'platform-pattern',
      };
    }
  }

  const $currency = findCurrencyPriceElement($, $scope) ?? findCurrencyPriceElement($);
  if ($currency) {
    const built = buildFirstMatchSelector($, $currency);
    if (built) {
      return { value: built.selector, regex: PRICE_REGEX_VALUE, confidence: 'low', source: 'currency-pattern' };
    }
  }

  return undefined;
}

const FLAG_LIKE_VALUE = /^(?:0|true|false|yes|no|on|off|null|undefined|none)$/i;

function isFlagLikeValue(value) {
  return FLAG_LIKE_VALUE.test(String(value).trim());
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

const PRODUCT_ID_INPUT_PATTERNS = [
  ['input[name="product_id"]', 'value'],
  ['input[name="variant_id"]', 'value'],
  ['input[name="add-to-cart"]', 'value'],
  ['button[name="add-to-cart"]', 'value'],
  ['form[action*="cart" i] input[name="id"]', 'value'],
];

function detectProductId($, pathname) {
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

    const $rendered = structured.elements.id;
    if ($rendered && $rendered.length) {
      const built = buildSelector($, $rendered);
      if (built) return { source: 'selector', selector: built.selector, confidence: 'high' };
    }
  }

  for (const [selector, attr] of [...PRODUCT_ID_ATTR_PATTERNS, ...PRODUCT_ID_INPUT_PATTERNS]) {
    let $el;
    try {
      $el = $(selector).first();
    } catch {
      continue;
    }
    if (!$el.length) continue;
    const attrValue = attr === 'value' ? $el.attr('value') : $el.attr(attr) ?? $el.attr('content');
    if (!attrValue) continue;
    if (isFlagLikeValue(attrValue)) continue;
    if (isInsideChrome($el) || CHROME_TAGS.has(tagNameOf($el))) continue;
    const built = buildSelector($, $el);
    if (built) {
      const realAttr = attr === 'value' ? 'value' : $el.attr(attr) ? attr : 'content';
      return { source: 'selector', selector: `${built.selector}::attr(${realAttr})`, confidence: 'medium' };
    }
  }

  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && /[-\d]/.test(last)) {
    return { source: 'url', urlPatternOverride: `/${segments.slice(0, -1).concat(':id').join('/')}` };
  }

  return { source: 'url' };
}

const ARCHIVE_CART_COUNTERPARTS = {
  'button[name="add-to-cart"]': 'a.add_to_cart_button',
  '[name="add-to-cart"]': 'a.add_to_cart_button',
  '.single_add_to_cart_button': 'a.add_to_cart_button',
  'button.single_add_to_cart_button': 'a.add_to_cart_button',
  '.product-form__submit': 'button.quick-add__submit',
  'button.product-form__submit': 'button.quick-add__submit',
  '#product-addtocart-button': 'button.tocart',
};

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

  const counterpart = ARCHIVE_CART_COUNTERPARTS[built.selector];
  let value = built.selector;
  if (counterpart) {
    const combined = `${built.selector}, ${counterpart}`;
    try {
      if ($(combined).length > $(built.selector).length) value = combined;
    } catch {
    }
  }

  return { value, confidence, source: found.source };
}


const LOGIN_TEXT = /\b(sign[\s-]?in|log[\s-]?in|login)\b/i;

const LOGIN_PAGE_MAX_TEXT_LENGTH = 1200;

function isHiddenElement($el) {
  if (!$el || !$el.length) return false;
  if ($el.attr('hidden') !== undefined) return true;
  const style = ($el.attr('style') || '').replace(/\s+/g, '').toLowerCase();
  if (style.includes('display:none') || style.includes('visibility:hidden')) return true;
  return /(^|[\s-])hidden([\s-]|$)/i.test($el.attr('class') || '');
}

const LOGIN_WALL_TEXT =
  /\b(?:log\s?in|logged\s+in|sign\s?in|signed\s+in)\b[^.!?]{0,60}?\bto\s+(?:view|see|access)\b/i;

function visibleText($) {
  const clone = $.root().clone();
  clone.find('script, style, noscript').remove();
  return clone.text().replace(/\s+/g, ' ').trim();
}

function looksLikeLoginPage($) {
  if (LOGIN_WALL_TEXT.test(visibleText($))) return true;

  if (structuredProductEvidence($)) return false;

  const title = $('title').first().text();
  const h1 = $('h1').first().text();
  if (LOGIN_TEXT.test(title) || LOGIN_TEXT.test(h1)) return true;

  if (hasCheckoutSignals($) || hasOrderSignals($)) return false;

  const visiblePasswordFields = $('form input[type="password"]').filter(
    (_, el) => !isHiddenElement($(el)) && !isHiddenElement($(el).closest('form'))
  );
  if (visiblePasswordFields.length === 0) return false;

  return visibleTextLength($) < LOGIN_PAGE_MAX_TEXT_LENGTH;
}

function visibleTextLength($) {
  return visibleText($).length;
}

const MIN_VISIBLE_TEXT_LENGTH = 200;

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

const ORDER_SIGNAL_TEXT =
  /order\s*(id|no\.?|number|#|confirm|received|placed|complete|summary|details|total)|thank\s*you.*order|your\s*order|purchase\s*complete|payment\s*(received|confirmed|successful)|order\s*confirmation|invoice\s*(no\.?|number|#)|receipt/i;

function hasOrderSignals($) {
  return ORDER_SIGNAL_TEXT.test($('body').text());
}

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

  const addToCart = detectAddToCart($);
  if (addToCart) result.addToCartSelector = addToCart;

  const $scope = productSummaryScope($, findProductTitleElement($), findAddToCartElement($)?.$el);
  const price = detectProductPrice($, $scope);
  if (price) {
    result.productPriceSelector = { value: price.value, confidence: price.confidence, source: price.source };
    result.productPriceRegex = { value: price.regex, confidence: price.confidence, source: price.source };
  }

  const name = detectProductName($, { hasOtherProductEvidence: Boolean(price || addToCart) });
  if (name) result.productNameSelector = name;

  return result;
}


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

const ORDER_ID_VALUE = /#?([a-f0-9-]{6,})/i;
const ORDER_ID_ANY_VALUE = /#?\s*([A-Za-z-]*\d[A-Za-z0-9_-]{2,})/;

const ORDER_ID_HEX_RUN = /(?:^|[^A-Za-z0-9_-])[a-f0-9-]{6,}(?:$|[^A-Za-z0-9_-])/i;
const ORDER_ID_DIGIT_WORD = /[A-Za-z-]*\d[A-Za-z0-9_-]*/;

const ORDER_ID_PATTERNS = [
  '.woocommerce-order-overview__order', '.os-order-number', '[data-order-number]', '[data-order-id]',
  '[data-testid*="order-number" i]', '[data-testid*="order-id" i]',
  '[class*="order-number" i]', '[class*="order_number" i]', '[class*="order-id" i]',
  '[class*="order_id" i]', '[class*="orderid" i]', '[class*="confirmation-number" i]',
  '[id*="order-number" i]', '[id*="order_number" i]', '[id*="order-id" i]',
];

const ORDER_TOTAL_PATTERNS = [
  '.woocommerce-order-overview__total', '.payment-due__price', '.total-line--total .total-line__price',
  '[data-order-total]', '[data-testid*="order-total" i]', '[data-testid*="grand-total" i]',
  '[class*="order-total" i]', '[class*="order_total" i]', '[class*="grand-total" i]',
  '[class*="grand_total" i]', '[id*="order-total" i]', '[id*="grand-total" i]',
];

function orderIdRegexFor(text) {
  const hashed = /#\s*([A-Za-z0-9][A-Za-z0-9_-]*)/.exec(text);
  if (hashed) {
    return /^[a-f0-9-]+$/i.test(hashed[1]) ? '#([a-f0-9-]+)' : '#([A-Za-z0-9][A-Za-z0-9_-]+)';
  }
  if (ORDER_ID_HEX_RUN.test(text)) return '([a-f0-9-]{6,})';
  if (ORDER_ID_DIGIT_WORD.test(text)) return '([A-Za-z-]*\\d[A-Za-z0-9_-]*)';
  return undefined;
}

function elementRenderingValue($, rawValue) {
  const target = normalizeForCompare(String(rawValue));
  if (!target) return null;
  return findSmallestElementContaining($, (text) => normalizeForCompare(text).includes(target));
}

function detectOrderId($) {
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

const ORDER_ITEM_PATTERNS = [
  '.woocommerce-table--order-details tbody tr.order_item', 'tr.order_item',
  '.product-table .product', '.order-summary__section--product-list .product',
  '[data-order-item]', '[data-line-item]', '[data-testid*="line-item" i]',
  '.order-item', '.line-item', '.order-line', '.cart-item', '.product-line-item',
];

const ORDER_ITEM_PRICE_PATTERNS = [
  '.woocommerce-Price-amount', 'td.product-total', 'td.woocommerce-table__product-total',
  '[class*="product-total" i]', '[class*="item-total" i]', '[class*="line-total" i]',
  '[data-item-price]', '[data-testid*="line-price" i]',
  '[class*="price" i]', '[class*="amount" i]', '[class*="total" i]',
];

const ORDER_ITEM_NAME_PATTERNS = [
  'td.product-name a', '.woocommerce-table__product-name a', 'td.product-name',
  '[class*="product-name" i] a', '[class*="item-name" i]', '[class*="line-item-title" i]',
  '[data-item-name]', '[data-testid*="item-name" i]',
  '[class*="product-name" i]', '[class*="product-title" i]',
];

const ORDER_ITEM_QTY_PATTERNS = [
  'strong.product-quantity', '.product-quantity', 'td.product-quantity',
  '[class*="product-quantity" i]', '[class*="item-quantity" i]', '[class*="line-quantity" i]',
  '[data-item-quantity]', '[data-testid*="quantity" i]',
  '[class*="quantity" i]', '[class*="qty" i]',
];

const CLASSLESS_REPEAT_TAGS = new Set(['tr', 'li']);

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

  const CLEAN_NUMBER = /^[\d,]+\.?\d*$/;
  let $price = null;
  $first.find('*').each((_, el) => {
    if ($price) return;
    const $el = $(el);
    if ($el.find('*').length === 0 && CLEAN_NUMBER.test($el.text().trim())) $price = $el;
  });

  if (!$price) {
    const priceCandidate = firstMatchingPattern(
      $,
      ORDER_ITEM_PRICE_PATTERNS,
      ($el) => PRICE_PATTERN.test($el.text()),
      $first
    );
    if (priceCandidate) $price = priceCandidate.$el;
  }
  if ($price) {
    const built = buildFirstMatchSelectorWithin($, $first, $price);
    if (built) {
      result.orderItemPriceSelector = { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source };
    }
  }

  let $name = null;
  const nameCandidate = firstMatchingPattern(
    $,
    ORDER_ITEM_NAME_PATTERNS,
    ($el) => {
      if ($price && $el.get(0) === $price.get(0)) return false;
      const text = $el.text().trim();
      return text.length >= 2 && text.length <= 200 && !/^[\d.,\s×x]+$/i.test(text);
    },
    $first
  );
  if (nameCandidate) $name = nameCandidate.$el;

  if (!$name) {
    let longest = 0;
    $first.find('*').each((_, el) => {
      const $el = $(el);
      if ($el.find('*').length > 0) return;
      const text = $el.text().trim();
      if (text && !/^[\d.,\s]+$/.test(text) && text.length > longest) {
        longest = text.length;
        $name = $el;
      }
    });
  }
  if ($name) {
    const built = buildFirstMatchSelectorWithin($, $first, $name);
    if (built) result.orderItemNameSelector = { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source };
  }

  let $qty = null;
  $first.find('*').each((_, el) => {
    if ($qty) return;
    const $el = $(el);
    if ($el.find('*').length > 0) return;
    if ($price && $el.get(0) === $price.get(0)) return;
    const text = $el.text().trim();
    if (/^\d{1,3}$/.test(text)) $qty = $el;
  });

  if (!$qty) {
    const DECORATED_QTY = /^(?:qty|quantity|×|x)?[\s:.·]*\d{1,3}$|^\d{1,3}\s*(?:pcs?|items?|units?)$/i;
    const qtyCandidate = firstMatchingPattern(
      $,
      ORDER_ITEM_QTY_PATTERNS,
      ($el) => {
        if ($price && $el.get(0) === $price.get(0)) return false;
        const text = $el.text().trim().replace(/ /g, ' ').replace(/\s+/g, ' ');
        return text.length <= 20 && DECORATED_QTY.test(text);
      },
      $first
    );
    if (qtyCandidate) $qty = qtyCandidate.$el;
  }
  if ($qty) {
    const built = buildFirstMatchSelectorWithin($, $first, $qty);
    if (built) {
      result.orderItemQtySelector = { value: built.selector, confidence: TIER_CONFIDENCE[built.tier], source };
    }
  }

  const attrCandidates = ['data-product-id', 'data-sku', 'data-id', 'data-variant-id'];
  for (const attr of attrCandidates) {
    if ($first.attr(attr)) {
      result.orderItemIdSelector = { value: `[${attr}]::attr(${attr})`, confidence: 'high', source };
      break;
    }
  }
  if (!result.orderItemIdSelector) {
    let $idEl = null;
    for (const attr of attrCandidates) {
      $idEl = $first.find(`[${attr}]`).first();
      if ($idEl.length) {
        const built = buildFirstMatchSelectorWithin($, $first, $idEl);
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

  if (!result.orderItemIdSelector) {
    const $link = $first
      .find('a[href]')
      .filter((_, el) => {
        const href = $(el).attr('href') || '';
        if (!href || href.startsWith('#') || /^(?:javascript|mailto|tel):/i.test(href)) return false;
        return !/remove|delete|undo|cart-item-key/i.test(href + ' ' + ($(el).attr('class') || ''));
      })
      .first();

    if ($link.length) {
      const built = buildFirstMatchSelectorWithin($, $first, $link);
      if (built) {
        result.orderItemIdSelector = {
          value: `${built.selector}::attr(href)`,
          confidence: 'medium',
          source: 'product-link',
        };
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

  const id = detectOrderId($);
  const total = detectOrderTotal($);

  const currency = detectOrderCurrency($, websiteCurrency, total);
  if (currency) {
    result.orderCurrency = currency;
  }

  if (id) {
    result.orderIdSelector = id.selector;
    result.orderIdRegex = id.regex;
  }

  if (total) {
    result.orderTotalSelector = total.selector;
    result.orderTotalRegex = total.regex;
  }

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


const CHECKOUT_SIGNAL_TEXT =
  /\b(check\s?out|shopping\s*cart|your\s*cart|cart\s*summary|order\s*summary|place\s*(your\s*)?order|proceed\s*to\s*(payment|checkout)|billing\s*details|shipping\s*(address|details)|payment\s*method)\b/i;

function hasCheckoutSignals($) {
  return CHECKOUT_SIGNAL_TEXT.test($('body').text());
}

const CHECKOUT_TOTAL_PATTERNS = [
  '.order-total .woocommerce-Price-amount', 'tr.order-total td', '.cart-subtotal td',
  '[data-checkout-total]', '[data-testid*="checkout-total" i]', '[data-testid*="cart-total" i]',
  '[class*="checkout-total" i]', '[class*="cart-total" i]', '[class*="grand-total" i]',
  '[class*="order-total" i]', '[id*="checkout-total" i]', '[id*="cart-total" i]',
];

function detectCheckoutTotal($) {
  const platform = firstMatchingPattern($, CHECKOUT_TOTAL_PATTERNS, ($el) => {
    const text = $el.text().trim();
    return text.length <= 200 && PRICE_PATTERN.test(text);
  });
  if (platform) {
    const built = buildFirstMatchSelector($, platform.$el);
    if (built) {
      const base = confidenceForSelector('platform', built.tier);
      return {
        selector: { value: built.selector, confidence: built.unique ? base : lowerOf(base, 'medium'), source: 'platform-pattern' },
        regex: { value: PRICE_REGEX_VALUE, confidence: 'medium', source: 'platform-pattern' },
      };
    }
  }
  return detectOrderTotal($);
}

const EMPTY_CART_TEXT =
  /\b(?:your\s+)?(?:shopping\s+)?(?:cart|basket|bag)\s+is\s+(?:currently\s+)?empty|no\s+items?\s+in\s+your\s+(?:cart|basket|bag)|cart\s+is\s+empty/i;
const EMPTY_CART_SELECTORS = '.cart-empty, .wc-empty-cart-message, .is-empty, [class*="empty-cart" i], [class*="cart-empty" i]';

function looksLikeEmptyCart($) {
  try {
    if ($(EMPTY_CART_SELECTORS).length > 0) return true;
  } catch {
  }
  return EMPTY_CART_TEXT.test(visibleText($));
}

export function detectCheckoutConfig(html, pageUrl, requestedUrl) {
  const $ = cheerio.load(html);
  const pathname = new URL(pageUrl).pathname;
  const triggerPathname = new URL(requestedUrl ?? pageUrl).pathname;

  if (looksLikeEmptyCart($)) {
    throw new DetectionClassificationError(
      'checkout_cart_empty',
      'This cart/checkout page is empty when the server fetches it — a cart belongs to a browser session, and the server has none, so there are no line items or total to read. The trigger URL pattern below WAS detected; fill the total and item selectors with the 🎯 picker (open your own cart with items in it), or paste that page\'s rendered HTML into "Test Detection".',
      {
        checkoutTriggerUrlPattern: {
          value: urlPatternFromPath(triggerPathname),
          confidence: 'medium',
          source: 'url-structure',
        },
      }
    );
  }

  classifyPageOrThrow($, 'checkout data');

  const result = {};
  result.checkoutTriggerUrlPattern = { value: urlPatternFromPath(triggerPathname), confidence: 'medium', source: 'url-structure' };

  const total = detectCheckoutTotal($);
  if (total) {
    result.checkoutTotalSelector = total.selector;
    result.checkoutTotalRegex = total.regex;
  }

  if (!total && !hasCheckoutSignals($)) {
    throw new DetectionClassificationError(
      'checkout_signals_missing',
      "This page doesn't look like a cart or checkout page (no cart total, line items, or checkout wording found). Please paste the URL of your cart or checkout page."
    );
  }

  const items = detectOrderItems($);
  if (items) {
    for (const [key, field] of Object.entries(items)) {
      result[key.replace(/^orderItem/, 'checkoutItem')] = field;
    }
  }

  return result;
}
