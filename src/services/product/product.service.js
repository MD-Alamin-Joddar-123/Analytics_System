import { productRepository } from '../../repositories/product.repository.js';
import { toMinorUnits } from '../../utils/money.js';

// Products are upserted from commerce events — there is no separate
// product-sync system in Phase 6 (§4). Safe to call repeatedly for the
// same externalProductId: the first sighting creates the document, every
// later sighting just refreshes lastSeenAt and whatever metadata this
// particular event happened to include.
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
      // Lost a race with a concurrent first sighting of the same product
      // (Phase 3/5 pattern, same reasoning) — use whichever document
      // actually landed rather than erroring or creating a duplicate.
      const winner = await productRepository.findByWebsiteAndExternalId(websiteId, externalProductId);
      if (winner) {
        return winner;
      }
    }
    throw error;
  }
}

export const productService = { resolveProduct };
