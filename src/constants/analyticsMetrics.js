
export function mapEventToBucketIncrements(eventName, commerce) {
  switch (eventName) {
    case 'page_view':
      return { pageViews: 1 };

    case 'product_view':
      return { productViews: 1 };

    case 'add_to_cart': {
      const inc = { addToCarts: 1 };
      if (commerce?.isNewCart) {
        inc.cartsCreated = 1;
      }
      if (commerce?.cartItemChange) {
        const { quantity, unitPriceMinor } = commerce.cartItemChange;
        inc.cartItems = 1;
        inc.cartQuantity = quantity;
        inc.cartValueMinor = quantity * unitPriceMinor;
      }
      return inc;
    }

    case 'remove_from_cart':
      return { removeFromCarts: 1 };

    case 'checkout': {
      const inc = {};
      if (commerce?.isNewCheckout) {
        inc.checkoutStarted = 1;
      }
      return inc;
    }

    case 'purchase': {
      const inc = {};
      if (commerce?.isNewOrder && commerce.order) {
        const unitsSold = (commerce.orderItems ?? []).reduce((sum, item) => sum + item.quantity, 0);
        inc.orders = 1;
        inc.unitsSold = unitsSold;
        inc.grossRevenueMinor = commerce.order.total ?? 0;
        inc.refundedAmountMinor = commerce.order.refundedAmount ?? 0;
        inc.netRevenueMinor = (commerce.order.total ?? 0) - (commerce.order.refundedAmount ?? 0);
      }
      if (commerce?.checkoutJustCompleted) {
        inc.checkoutCompleted = 1;
      }
      return inc;
    }

    default:
      return {};
  }
}

export function mapEventToProductOperations(eventName, commerce) {
  switch (eventName) {
    case 'product_view': {
      if (!commerce?.product) return [];
      return [
        {
          externalProductId: commerce.product.externalProductId,
          productName: commerce.product.name,
          inc: { productViews: 1 },
        },
      ];
    }

    case 'add_to_cart': {
      if (!commerce?.product) return [];
      return [
        {
          externalProductId: commerce.product.externalProductId,
          productName: commerce.product.name,
          inc: { addToCarts: 1 },
        },
      ];
    }

    case 'remove_from_cart': {
      if (!commerce?.externalProductId) return [];
      return [
        {
          externalProductId: commerce.externalProductId,
          productName: undefined,
          inc: { removeFromCarts: 1 },
        },
      ];
    }

    case 'purchase': {
      if (!commerce?.isNewOrder) return [];
      return (commerce.orderItems ?? []).map((orderItem) => ({
        externalProductId: orderItem.externalProductId,
        productName: orderItem.productName,
        inc: {
          unitsSold: orderItem.quantity,
          orders: 1,
          revenueMinor: orderItem.total ?? orderItem.subtotal ?? 0,
        },
      }));
    }

    default:
      return [];
  }
}
