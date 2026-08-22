import { setupMockPipeline } from './mockCollectPipeline.js';
import { productRepository } from '../../src/repositories/product.repository.js';
import { cartRepository } from '../../src/repositories/cart.repository.js';
import { cartItemRepository } from '../../src/repositories/cartItem.repository.js';
import { checkoutRepository } from '../../src/repositories/checkout.repository.js';
import { orderRepository } from '../../src/repositories/order.repository.js';
import { orderItemRepository } from '../../src/repositories/orderItem.repository.js';

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// Builds on setupMockPipeline (website/event/visitor/session) and
// replaces its lightweight commerce-repository pass-throughs with
// realistic in-memory stores (including duplicate-key race simulation on
// every create), so Phase 6 tests can drive multi-request commerce flows
// end-to-end through the real HTTP → validator → controller → service
// chain and inspect the resulting documents directly — same philosophy as
// mockCollectPipeline.js's visitor/session stores.
export function setupMockCommercePipeline(t, options = {}) {
  const base = setupMockPipeline(t, options);

  const products = new Map(); // `${websiteId}:${externalProductId}` -> doc
  const carts = new Map(); // `${websiteId}:${cartId}` -> doc
  const cartItems = new Map(); // `${websiteId}:${cartId}:${externalProductId}` -> doc
  const checkouts = new Map(); // `${websiteId}:${checkoutId}` -> doc
  const orders = new Map(); // `${websiteId}:${externalOrderId}` -> doc
  const orderItems = []; // flat list, mirrors OrderItem having no unique identity constraint

  function duplicateKeyError() {
    const err = new Error('duplicate key');
    err.code = 11000;
    return err;
  }

  t.mock.method(productRepository, 'findByWebsiteAndExternalId', async (websiteId, externalProductId) =>
    products.get(`${websiteId}:${externalProductId}`) ?? null
  );
  t.mock.method(productRepository, 'create', async (doc) => {
    const key = `${doc.websiteId}:${doc.externalProductId}`;
    if (products.has(key)) throw duplicateKeyError();
    const record = { ...doc, _id: nextId('product') };
    products.set(key, record);
    return record;
  });
  t.mock.method(productRepository, 'recordSighting', async (id, updates) => {
    const record = [...products.values()].find((p) => p._id === id);
    if (!record) return null;
    record.lastSeenAt = updates.lastSeenAt;
    if (updates.name !== undefined) record.name = updates.name;
    if (updates.price !== undefined) record.price = updates.price;
    if (updates.currency !== undefined) record.currency = updates.currency;
    return record;
  });

  t.mock.method(cartRepository, 'findByWebsiteAndCartId', async (websiteId, cartId) =>
    carts.get(`${websiteId}:${cartId}`) ?? null
  );
  t.mock.method(cartRepository, 'create', async (doc) => {
    const key = `${doc.websiteId}:${doc.cartId}`;
    if (carts.has(key)) throw duplicateKeyError();
    const record = { ...doc, _id: nextId('cart') };
    carts.set(key, record);
    return record;
  });
  t.mock.method(cartRepository, 'adjustTotals', async (id, { itemCountDelta, subtotalDelta, lastUpdatedAt }) => {
    const record = [...carts.values()].find((c) => c._id === id);
    if (!record) return null;
    record.itemCount += itemCountDelta;
    record.subtotal += subtotalDelta;
    record.lastUpdatedAt = lastUpdatedAt;
    return record;
  });

  t.mock.method(cartItemRepository, 'findByCartAndProduct', async (websiteId, cartId, externalProductId) =>
    cartItems.get(`${websiteId}:${cartId}:${externalProductId}`) ?? null
  );
  t.mock.method(cartItemRepository, 'create', async (doc) => {
    const key = `${doc.websiteId}:${doc.cartId}:${doc.externalProductId}`;
    if (cartItems.has(key)) throw duplicateKeyError();
    const record = { ...doc, _id: nextId('cartItem') };
    cartItems.set(key, record);
    return record;
  });
  t.mock.method(cartItemRepository, 'incrementQuantity', async (id, delta) => {
    const record = [...cartItems.values()].find((ci) => ci._id === id);
    if (!record) return null;
    record.quantity += delta;
    return record;
  });
  t.mock.method(cartItemRepository, 'deleteById', async (id) => {
    for (const [key, record] of cartItems.entries()) {
      if (record._id === id) {
        cartItems.delete(key);
        return record;
      }
    }
    return null;
  });

  t.mock.method(checkoutRepository, 'findByWebsiteAndCheckoutId', async (websiteId, checkoutId) =>
    checkouts.get(`${websiteId}:${checkoutId}`) ?? null
  );
  t.mock.method(checkoutRepository, 'create', async (doc) => {
    const key = `${doc.websiteId}:${doc.checkoutId}`;
    if (checkouts.has(key)) throw duplicateKeyError();
    const record = { ...doc, _id: nextId('checkout') };
    checkouts.set(key, record);
    return record;
  });
  t.mock.method(checkoutRepository, 'update', async (id, updates) => {
    const record = [...checkouts.values()].find((c) => c._id === id);
    if (!record) return null;
    Object.assign(record, updates);
    return record;
  });

  t.mock.method(orderRepository, 'findByWebsiteAndExternalOrderId', async (websiteId, externalOrderId) =>
    orders.get(`${websiteId}:${externalOrderId}`) ?? null
  );
  t.mock.method(orderRepository, 'create', async (doc) => {
    const key = `${doc.websiteId}:${doc.externalOrderId}`;
    if (orders.has(key)) throw duplicateKeyError();
    const record = { ...doc, _id: nextId('order') };
    orders.set(key, record);
    return record;
  });
  t.mock.method(orderRepository, 'update', async (id, updates) => {
    const record = [...orders.values()].find((o) => o._id === id);
    if (!record) return null;
    Object.assign(record, updates);
    return record;
  });

  t.mock.method(orderItemRepository, 'createMany', async (docs) => {
    const records = docs.map((doc) => ({ ...doc, _id: nextId('orderItem') }));
    orderItems.push(...records);
    return records;
  });
  t.mock.method(orderItemRepository, 'findByOrder', async (websiteId, orderId) =>
    orderItems.filter((oi) => oi.websiteId === websiteId && String(oi.orderId) === String(orderId))
  );

  return { ...base, products, carts, cartItems, checkouts, orders, orderItems };
}
