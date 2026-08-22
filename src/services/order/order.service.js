import { orderRepository } from '../../repositories/order.repository.js';
import { orderItemRepository } from '../../repositories/orderItem.repository.js';
import { toMinorUnits } from '../../utils/money.js';

// Order idempotency (§12): identity is websiteId + externalOrderId — this
// is a SEPARATE guarantee from Phase 4/5's websiteId + eventId event
// idempotency, and a genuinely necessary one: two different events (two
// different eventIds — e.g. a client retry that regenerated its eventId,
// or two distinct webhook deliveries for the same order) can carry the
// same externalOrderId, and the outer event-level idempotency check has
// no way to catch that. This is a real upsert, not a strict
// reject-duplicate: an order's status/payment fields are expected to
// evolve over its lifecycle across multiple purchase events (pending →
// paid → ...), so a second event for a known externalOrderId updates the
// existing document rather than being treated as a no-op duplicate. What
// it does NOT do is create a second Order — the unique index plus the
// pre-check + duplicate-key-catch pattern (Phase 3/5) guarantee that.
async function upsertOrder(websiteId, data, context) {
  const { externalOrderId } = data;

  const existing = await orderRepository.findByWebsiteAndExternalOrderId(websiteId, externalOrderId);
  if (existing) {
    const updates = {};
    if (data.paymentStatus !== undefined) updates.paymentStatus = data.paymentStatus;
    if (data.subtotalMinor !== undefined) updates.subtotal = data.subtotalMinor;
    if (data.discountMinor !== undefined) updates.discount = data.discountMinor;
    if (data.shippingMinor !== undefined) updates.shipping = data.shippingMinor;
    if (data.taxMinor !== undefined) updates.tax = data.taxMinor;
    if (data.totalMinor !== undefined) updates.total = data.totalMinor;
    const updated = await orderRepository.update(existing._id, updates);
    return { order: updated, isNew: false };
  }

  try {
    const created = await orderRepository.create({
      websiteId,
      externalOrderId,
      visitorId: context.visitor?._id,
      anonymousId: context.visitor?.anonymousId,
      sessionId: context.session?.sessionId,
      currency: data.currency,
      subtotal: data.subtotalMinor,
      discount: data.discountMinor,
      shipping: data.shippingMinor,
      tax: data.taxMinor,
      total: data.totalMinor,
      orderStatus: 'pending',
      paymentStatus: data.paymentStatus ?? 'pending',
      fulfillmentStatus: 'unfulfilled',
      refundedAmount: 0,
      orderCreatedAt: context.receivedAt,
      purchasedAt: context.receivedAt,
    });
    return { order: created, isNew: true };
  } catch (error) {
    if (error.code === 11000) {
      // Lost a race with a concurrent purchase for the same
      // externalOrderId — use whichever document actually landed, and
      // report isNew: false so the caller skips OrderItem creation (the
      // winning request already created them).
      const winner = await orderRepository.findByWebsiteAndExternalOrderId(websiteId, externalOrderId);
      if (winner) {
        return { order: winner, isNew: false };
      }
    }
    throw error;
  }
}

// OrderItems are created exactly once — only when the Order document is
// first created (§12: "duplicate purchase does not duplicate items").
// Never called for the update branch of upsertOrder, by construction: the
// caller only invokes this when isNew is true.
async function createOrderItems(websiteId, order, productItems, currency) {
  if (!productItems || productItems.length === 0) {
    return [];
  }

  const docs = productItems.map(({ item, product }) => {
    const unitPriceMinor = toMinorUnits(item.price) ?? 0;
    const quantity = item.quantity;
    const lineSubtotal = unitPriceMinor * quantity;
    return {
      websiteId,
      orderId: order._id,
      externalProductId: item.productId,
      productId: product?._id,
      productName: item.name,
      unitPrice: unitPriceMinor,
      quantity,
      subtotal: lineSubtotal,
      discount: 0,
      total: lineSubtotal,
      currency,
    };
  });

  return orderItemRepository.createMany(docs);
}

export const orderService = { upsertOrder, createOrderItems };
