import { cartRepository } from '../../repositories/cart.repository.js';
import { cartItemRepository } from '../../repositories/cartItem.repository.js';
import { toMinorUnits } from '../../utils/money.js';

// No cartId, no cart — mirrors the missing-anonymousId/sessionId
// graceful-degradation pattern from Phase 5: the triggering event is
// still accepted and stored regardless, this just means there is nothing
// to link it to.
// Returns { cart, isNew } — the isNew flag is Phase 8's cartsCreated
// analytics counter's source of truth (see eventProcessing.service.js and
// docs/ANALYTICS_ARCHITECTURE.md), reusing this existing create-vs-found
// decision rather than building a second way to detect "was this cart
// actually new" (Phase 8 §9's "no second idempotency system" principle,
// applied to carts as well as orders/checkouts).
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

// add_to_cart semantics (§24, documented choice): `quantity` on the event
// is INCREMENTAL — "this many were just added" — not the cart's new
// absolute quantity for the product. Repeated add_to_cart events for the
// same product accumulate: quantity 1, then quantity 1 again, means 2 in
// the cart, not 1. This matches how tracking SDKs universally fire this
// event (once per "add" action the shopper takes), and is the more common
// convention across ecommerce platforms.
// Returns { cart, isNewCart, cartItemChange } — cartItemChange (§17,
// Phase 8) is the { quantity, unitPriceMinor } this specific event just
// added, the source for the cartQuantity/cartValueMinor analytics
// counters. null when there was nothing to record (no cartId, or the
// event didn't resolve to a known product).
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
        // Lost a race with a concurrent add_to_cart for the same product
        // in the same cart — treat it as "found existing" and increment.
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

// remove_from_cart semantics (§24, documented choice): `quantity` is also
// INCREMENTAL — "remove this many" — never allowed to take the line item
// below zero. A removal that would reach zero (or the item/cart simply
// doesn't exist — a desynced or already-cleared client) deletes the
// CartItem entirely rather than leaving a zero/negative-quantity row.
async function removeFromCart(websiteId, { cartId, externalProductId, quantity }, context) {
  if (!cartId || !externalProductId) {
    return null;
  }

  const cart = await cartRepository.findByWebsiteAndCartId(websiteId, cartId);
  if (!cart) {
    return null; // nothing to remove from — safe no-op
  }

  const existingItem = await cartItemRepository.findByCartAndProduct(websiteId, cartId, externalProductId);
  if (!existingItem) {
    return cart; // nothing to remove — safe no-op
  }

  const removeQty = Math.min(quantity, existingItem.quantity); // never overshoot into negative
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
