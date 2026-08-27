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
