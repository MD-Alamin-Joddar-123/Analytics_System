import { productRepository } from '../../repositories/product.repository.js';
import { toMinorUnits } from '../../utils/money.js';

async function resolveProduct(websiteId, { externalProductId, name, price, currency }, receivedAt) {
  if (!externalProductId) {
    return null;
  }

  const priceMinor = price !== undefined ? toMinorUnits(price) : undefined;

  const existing = await productRepository.findByWebsiteAndExternalId(websiteId, externalProductId);
  if (existing) {
    return productRepository.recordSighting(existing._id, {
      lastSeenAt: receivedAt,
      name,
      price: priceMinor,
      currency,
    });
  }

  try {
    return await productRepository.create({
      websiteId,
      externalProductId,
      name,
      price: priceMinor,
      currency,
      status: 'active',
      firstSeenAt: receivedAt,
      lastSeenAt: receivedAt,
    });
  } catch (error) {
    if (error.code === 11000) {
      const winner = await productRepository.findByWebsiteAndExternalId(websiteId, externalProductId);
      if (winner) {
        return winner;
      }
    }
    throw error;
  }
}

export const productService = { resolveProduct };
