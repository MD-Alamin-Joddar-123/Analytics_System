import { checkoutRepository } from '../../repositories/checkout.repository.js';

// Creates or refreshes a Checkout from a `checkout` event. Financial
// fields are last-write-wins (only the fields this particular event
// actually provided are updated) — a checkout event resent with more
// complete totals than an earlier one simply fills them in.
// Returns { checkout, isNew } — isNew is Phase 8's checkoutStarted
// analytics counter's source of truth (reusing this create-vs-found
// decision, not a second idempotency system — see cart.service.js's
// resolveCart for the same pattern applied to carts).
async function upsertCheckout(websiteId, data, context) {
  const { checkoutId } = data;
  if (!checkoutId) {
    return { checkout: null, isNew: false };
  }

  const existing = await checkoutRepository.findByWebsiteAndCheckoutId(websiteId, checkoutId);
  if (existing) {
    const updates = {};
    if (data.cartId !== undefined) updates.cartId = data.cartId;
    if (data.currency !== undefined) updates.currency = data.currency;
    if (data.subtotalMinor !== undefined) updates.subtotal = data.subtotalMinor;
    if (data.discountMinor !== undefined) updates.discount = data.discountMinor;
    if (data.shippingMinor !== undefined) updates.shipping = data.shippingMinor;
    if (data.taxMinor !== undefined) updates.tax = data.taxMinor;
    if (data.totalMinor !== undefined) updates.total = data.totalMinor;
    const updated = await checkoutRepository.update(existing._id, updates);
    return { checkout: updated, isNew: false };
  }

  try {
    const created = await checkoutRepository.create({
      websiteId,
      checkoutId,
      cartId: data.cartId,
      visitorId: context.visitor?._id,
      sessionId: context.session?.sessionId,
      currency: data.currency,
      subtotal: data.subtotalMinor,
      discount: data.discountMinor,
      shipping: data.shippingMinor,
      tax: data.taxMinor,
      total: data.totalMinor,
      startedAt: context.receivedAt,
      status: 'started',
    });
    return { checkout: created, isNew: true };
  } catch (error) {
    if (error.code === 11000) {
      const winner = await checkoutRepository.findByWebsiteAndCheckoutId(websiteId, checkoutId);
      if (winner) {
        return { checkout: winner, isNew: false };
      }
    }
    throw error;
  }
}

// Called from a `purchase` event that supplied a checkoutId (§25). Only
// links/completes when that checkoutId actually resolves to a known
// Checkout — a purchase with an unrelated or missing checkoutId never
// marks any checkout completed. Idempotent: completing an
// already-completed checkout is a no-op, not an error.
// Returns { checkout, justCompleted } — justCompleted is true ONLY on the
// call that actually transitions status started -> completed (Phase 8's
// checkoutCompleted analytics counter's source of truth). A duplicate
// purchase event for an already-completed checkout, or one with no linked
// checkout, both report justCompleted: false, so analytics never double-
// counts a checkout completion.
async function completeCheckoutIfLinked(websiteId, checkoutId, completedAt) {
  if (!checkoutId) {
    return { checkout: null, justCompleted: false };
  }

  const existing = await checkoutRepository.findByWebsiteAndCheckoutId(websiteId, checkoutId);
  if (!existing) {
    return { checkout: null, justCompleted: false };
  }
  if (existing.status === 'completed') {
    return { checkout: existing, justCompleted: false };
  }

  const updated = await checkoutRepository.update(existing._id, { status: 'completed', completedAt });
  return { checkout: updated, justCompleted: true };
}

export const checkoutService = { upsertCheckout, completeCheckoutIfLinked };
