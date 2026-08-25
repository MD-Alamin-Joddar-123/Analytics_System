// Serializes a WebsiteTrackingConfig document for API responses — same
// pattern as utils/safeWebsite.js. Explicitly whitelists the fields the
// SDK/dashboard actually need rather than passing through whatever the
// Mongoose doc happens to carry: this is what guarantees a MongoDB `_id`,
// `__v`, or any future internal-only field added to the schema can never
// leak into a response without a deliberate change here.
//
// `updatedAt` IS included on purpose (unlike toSafeWebsite, which has no
// equivalent need) — the SDK's config cache (Step 4) uses it to decide
// whether a cached copy is stale, without re-fetching on every page load.
const PUBLIC_FIELDS = [
  'websiteId',
  'detectionMode',
  'productUrlPattern',
  'productIdSource',
  'productIdSelector',
  'productNameSelector',
  'productPriceSelector',
  'productPriceRegex',
  'orderTriggerUrlPattern',
  'orderIdSelector',
  'orderIdRegex',
  'orderTotalSelector',
  'orderTotalRegex',
  'orderCurrency',
  'orderItemContainerSelector',
  'orderItemIdSelector',
  'orderItemNameSelector',
  'orderItemPriceSelector',
  'orderItemQtySelector',
  'addToCartSelector',
  'checkoutTriggerUrlPattern',
  'checkoutTotalSelector',
  'checkoutTotalRegex',
  'checkoutItemContainerSelector',
  'checkoutItemIdSelector',
  'checkoutItemNameSelector',
  'checkoutItemPriceSelector',
  'checkoutItemQtySelector',
  'updatedAt',
];

export function toSafeTrackingConfig(config) {
  if (!config) return null;

  const plain = typeof config.toJSON === 'function' ? config.toJSON() : { ...config };
  const safe = {};
  for (const field of PUBLIC_FIELDS) {
    if (plain[field] !== undefined) safe[field] = plain[field];
  }
  return safe;
}
