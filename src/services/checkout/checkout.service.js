import { checkoutRepository } from '../../repositories/checkout.repository.js';

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
