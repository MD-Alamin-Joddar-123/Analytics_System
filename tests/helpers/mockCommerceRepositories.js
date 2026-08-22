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

// Lightweight, stateless pass-through mocks for the Phase 6 commerce
// repositories — every "find" resolves to nothing found, every "create"
// just echoes the document back with a fake id. Sufficient for tests that
// only care that event collection itself still works correctly now that
// it also touches these repositories (Phase 4/5 regression tests), where
// the resulting commerce documents themselves aren't under test. Tests
// that DO need to inspect realistic commerce state across requests use
// the fuller `setupMockPipeline` in mockCollectPipeline.js instead.
export function mockCommerceRepositories(t) {
  t.mock.method(productRepository, 'findByWebsiteAndExternalId', async () => null);
  t.mock.method(productRepository, 'create', async (doc) => ({ ...doc, _id: nextId('product') }));
  t.mock.method(productRepository, 'recordSighting', async (id, updates) => ({ _id: id, ...updates }));

  t.mock.method(cartRepository, 'findByWebsiteAndCartId', async () => null);
  t.mock.method(cartRepository, 'create', async (doc) => ({ ...doc, _id: nextId('cart') }));
  t.mock.method(cartRepository, 'adjustTotals', async (id, updates) => ({ _id: id, ...updates }));

  t.mock.method(cartItemRepository, 'findByCartAndProduct', async () => null);
  t.mock.method(cartItemRepository, 'create', async (doc) => ({ ...doc, _id: nextId('cartItem') }));
  t.mock.method(cartItemRepository, 'incrementQuantity', async (id, delta) => ({ _id: id, quantity: delta }));
  t.mock.method(cartItemRepository, 'deleteById', async () => null);

  t.mock.method(checkoutRepository, 'findByWebsiteAndCheckoutId', async () => null);
  t.mock.method(checkoutRepository, 'create', async (doc) => ({ ...doc, _id: nextId('checkout') }));
  t.mock.method(checkoutRepository, 'update', async (id, updates) => ({ _id: id, ...updates }));

  t.mock.method(orderRepository, 'findByWebsiteAndExternalOrderId', async () => null);
  t.mock.method(orderRepository, 'create', async (doc) => ({ ...doc, _id: nextId('order') }));
  t.mock.method(orderRepository, 'update', async (id, updates) => ({ _id: id, ...updates }));

  t.mock.method(orderItemRepository, 'createMany', async (docs) =>
    docs.map((doc) => ({ ...doc, _id: nextId('orderItem') }))
  );
  t.mock.method(orderItemRepository, 'findByOrder', async () => []);
}
