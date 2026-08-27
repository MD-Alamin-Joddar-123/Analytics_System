import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WebsiteTrackingConfig } from '../src/models/WebsiteTrackingConfig.js';
import { DETECTION_MODES, PRODUCT_ID_SOURCES } from '../src/constants/trackingConfig.js';
import { CURRENCY_CODES } from '../src/constants/currencies.js';


function findUniqueIndex(model, fields) {
  return model.schema.indexes().find(([keys, options]) => {
    const keyNames = Object.keys(keys);
    return keyNames.length === fields.length && fields.every((f, i) => keyNames[i] === f) && options?.unique === true;
  });
}

describe('WebsiteTrackingConfig — schema', () => {
  test('has a unique index on websiteId — one config document per website', () => {
    assert.ok(findUniqueIndex(WebsiteTrackingConfig, ['websiteId']));
  });

  test('websiteId is required (multi-tenant isolation, matches every other website-scoped model)', () => {
    assert.equal(WebsiteTrackingConfig.schema.path('websiteId').isRequired, true);
  });

  test('detectionMode enum matches DETECTION_MODES exactly, defaults to selector_regex', () => {
    const path = WebsiteTrackingConfig.schema.path('detectionMode');
    assert.deepEqual(path.enumValues, DETECTION_MODES);
    assert.equal(new WebsiteTrackingConfig({ websiteId: 'w1' }).detectionMode, 'selector_regex');
  });

  test('productIdSource enum matches PRODUCT_ID_SOURCES exactly, defaults to url', () => {
    const path = WebsiteTrackingConfig.schema.path('productIdSource');
    assert.deepEqual(path.enumValues, PRODUCT_ID_SOURCES);
    assert.equal(new WebsiteTrackingConfig({ websiteId: 'w1' }).productIdSource, 'url');
  });

  test('orderCurrency enum is the same ISO 4217 set every monetary field in this system validates against', () => {
    const path = WebsiteTrackingConfig.schema.path('orderCurrency');
    assert.deepEqual(new Set(path.enumValues), CURRENCY_CODES);
  });

  test('orderCurrency is uppercased — "bdt" and "BDT" must validate identically', () => {
    const doc = new WebsiteTrackingConfig({ websiteId: 'w1', orderCurrency: 'bdt' });
    assert.equal(doc.orderCurrency, 'BDT');
  });

  test('productIdSelector is required ONLY when productIdSource is "selector"', () => {
    const urlSourced = new WebsiteTrackingConfig({ websiteId: 'w1', productIdSource: 'url' });
    assert.equal(urlSourced.validateSync()?.errors?.productIdSelector, undefined);

    const selectorSourced = new WebsiteTrackingConfig({ websiteId: 'w1', productIdSource: 'selector' });
    assert.ok(selectorSourced.validateSync()?.errors?.productIdSelector, 'expected a validation error when the selector is missing');

    const selectorSourcedWithValue = new WebsiteTrackingConfig({
      websiteId: 'w1',
      productIdSource: 'selector',
      productIdSelector: '.product-id',
    });
    assert.equal(selectorSourcedWithValue.validateSync()?.errors?.productIdSelector, undefined);
  });

  test('an invalid detectionMode is rejected', () => {
    const doc = new WebsiteTrackingConfig({ websiteId: 'w1', detectionMode: 'not-a-real-mode' });
    assert.ok(doc.validateSync()?.errors?.detectionMode);
  });

  test('an invalid orderCurrency is rejected', () => {
    const doc = new WebsiteTrackingConfig({ websiteId: 'w1', orderCurrency: 'NOTREAL' });
    assert.ok(doc.validateSync()?.errors?.orderCurrency);
  });

  test('selector/URL-pattern fields accept plain strings and trim whitespace', () => {
    const doc = new WebsiteTrackingConfig({
      websiteId: 'w1',
      productUrlPattern: '  /product/:id  ',
      productNameSelector: ' .product-title ',
      orderTriggerUrlPattern: ' /order-confirmation/* ',
      orderItemContainerSelector: ' .order-item ',
      addToCartSelector: ' .add-to-cart-btn ',
    });
    assert.equal(doc.productUrlPattern, '/product/:id');
    assert.equal(doc.productNameSelector, '.product-title');
    assert.equal(doc.orderTriggerUrlPattern, '/order-confirmation/*');
    assert.equal(doc.orderItemContainerSelector, '.order-item');
    assert.equal(doc.addToCartSelector, '.add-to-cart-btn');
  });

  test('regex-pattern fields are stored as plain strings, never a native RegExp type', () => {
    for (const field of ['productPriceRegex', 'orderIdRegex', 'orderTotalRegex']) {
      assert.equal(WebsiteTrackingConfig.schema.path(field).instance, 'String');
    }
  });

  test('a fully-specified selector_regex config validates cleanly', () => {
    const doc = new WebsiteTrackingConfig({
      websiteId: 'w1',
      detectionMode: 'selector_regex',
      productUrlPattern: '/product/:id',
      productIdSource: 'url',
      productNameSelector: '.product-title',
      productPriceSelector: '.price',
      productPriceRegex: '([\\d.]+)',
      orderTriggerUrlPattern: '/order-confirmation/*',
      orderIdSelector: '.order-id',
      orderIdRegex: '#(.+)',
      orderTotalSelector: '.order-total',
      orderTotalRegex: '([\\d.]+)Tk',
      orderCurrency: 'BDT',
      orderItemContainerSelector: '.order-item',
      orderItemIdSelector: '[data-product-id]::attr(data-product-id)',
      orderItemNameSelector: '.item-name',
      orderItemPriceSelector: '.item-price',
      orderItemQtySelector: '.item-qty',
      addToCartSelector: '.add-to-cart-btn',
    });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.orderItemIdSelector, '[data-product-id]::attr(data-product-id)');
  });

  test('websiteId alone (all other fields absent) still validates — every detection field is optional', () => {
    const doc = new WebsiteTrackingConfig({ websiteId: 'w1' });
    assert.equal(doc.validateSync(), undefined);
  });
});
