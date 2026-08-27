import { cartRepository } from '../../repositories/cart.repository.js';
import { cartItemRepository } from '../../repositories/cartItem.repository.js';
import { toMinorUnits } from '../../utils/money.js';

async function resolveCart(websiteId, cartId, { visitor, session, currency, receivedAt }) {
  if (!cartId) {
    return { cart: null, isNew: false };
  }

  const existing = await cartRepository.findByWebsiteAndCartId(websiteId, cartId);
  if (existing) {
    return { cart: existing, isNew: false };
  }

  try {
    const created = await cartRepository.create({
      websiteId,
      cartId,
      visitorId: visitor?._id,
      anonymousId: visitor?.anonymousId,
      sessionId: session?.sessionId,
      currency,
      itemCount: 0,
      subtotal: 0,
      lastUpdatedAt: receivedAt,
    });
    return { cart: created, isNew: true };
  } catch (error) {
    if (error.code === 11000) {
      const winner = await cartRepository.findByWebsiteAndCartId(websiteId, cartId);
      if (winner) {
        return { cart: winner, isNew: false };
      }
    }
    throw error;
  }
}

async function addToCart(websiteId, { cartId, product, name, price, quantity, currency }, context) {
  if (!cartId) {
    return { cart: null, isNewCart: false, cartItemChange: null };
  }

  const { cart, isNew: isNewCart } = await resolveCart(websiteId, cartId, { ...context, currency });
  if (!cart) {
    return { cart: null, isNewCart: false, cartItemChange: null };
  }

  const externalProductId = product?.externalProductId;
  if (!externalProductId) {
    return { cart, isNewCart, cartItemChange: null };
  }

  const unitPriceMinor = toMinorUnits(price) ?? 0;

  const existingItem = await cartItemRepository.findByCartAndProduct(websiteId, cartId, externalProductId);
  if (existingItem) {
    await cartItemRepository.incrementQuantity(existingItem._id, quantity);
  } else {
    try {
      await cartItemRepository.create({
        websiteId,
        cartId,
        externalProductId,
        productId: product?._id,
        productName: name,
        unitPrice: unitPriceMinor,
        quantity,
        currency,
      });
    } catch (error) {
      if (error.code === 11000) {
        const winner = await cartItemRepository.findByCartAndProduct(websiteId, cartId, externalProductId);
        if (winner) {
          await cartItemRepository.incrementQuantity(winner._id, quantity);
        }
      } else {
        throw error;
      }
    }
  }

  await cartRepository.adjustTotals(cart._id, {
    itemCountDelta: quantity,
    subtotalDelta: unitPriceMinor * quantity,
    lastUpdatedAt: context.receivedAt,
  });

  return { cart, isNewCart, cartItemChange: { quantity, unitPriceMinor } };
}

async function removeFromCart(websiteId, { cartId, externalProductId, quantity }, context) {
  if (!cartId || !externalProductId) {
    return null;
  }

  const cart = await cartRepository.findByWebsiteAndCartId(websiteId, cartId);
  if (!cart) {
    return null;
  }

  const existingItem = await cartItemRepository.findByCartAndProduct(websiteId, cartId, externalProductId);
  if (!existingItem) {
    return cart;
  }

  const removeQty = Math.min(quantity, existingItem.quantity);
  const remaining = existingItem.quantity - removeQty;

  if (remaining <= 0) {
    await cartItemRepository.deleteById(existingItem._id);
  } else {
    await cartItemRepository.incrementQuantity(existingItem._id, -removeQty);
  }

  await cartRepository.adjustTotals(cart._id, {
    itemCountDelta: -removeQty,
    subtotalDelta: -(existingItem.unitPrice * removeQty),
    lastUpdatedAt: context.receivedAt,
  });

  return cart;
}

export const cartService = { resolveCart, addToCart, removeFromCart };
