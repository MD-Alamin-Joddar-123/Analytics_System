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

export function setupMockCommercePipeline(t, options = {}) {
  const base = setupMockPipeline(t, options);

  const products = new Map();
  const carts = new Map();
  const cartItems = new Map();
  const checkouts = new Map();
  const orders = new Map();
  const orderItems = [];

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
