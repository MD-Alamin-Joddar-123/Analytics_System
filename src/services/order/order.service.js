import { orderRepository } from '../../repositories/order.repository.js';
import { orderItemRepository } from '../../repositories/orderItem.repository.js';
import { toMinorUnits } from '../../utils/money.js';

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
      const winner = await orderRepository.findByWebsiteAndExternalOrderId(websiteId, externalOrderId);
      if (winner) {
        return { order: winner, isNew: false };
      }
    }
    throw error;
  }
}

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
