import { Website } from '../models/Website.js';

// Exported as a plain object (rather than named exports) so individual
// methods can be swapped/mocked at the boundary in tests without a live
// database connection — same pattern as user.repository.js.
//
// Ownership isolation is enforced HERE, not just in the service/controller:
// every owner-scoped method below filters by `ownerId` in the query itself
// (`findOne({ _id, ownerId })`), so a request for another user's website
// simply finds nothing rather than relying on an application-level check
// after the fact.
export const websiteRepository = {
  async create({ name, domain, websiteId, ownerId, timezone, currency }) {
    return Website.create({ name, domain, websiteId, ownerId, timezone, currency });
  },

  // Generic lookup by internal id, with no ownership filter. Reserved for
  // future internal/admin use (e.g. Phase 4 system-level tooling) — no
  // user-facing flow in Phase 3 uses this; those always go through
  // findByIdAndOwner so ownership can never be bypassed.
  async findById(id) {
    return Website.findById(id);
  },

  async findByIdAndOwner(id, ownerId) {
    return Website.findOne({ _id: id, ownerId });
  },

  async findByOwner(ownerId, { status } = {}) {
    const query = { ownerId };
    if (status) query.status = status;
    return Website.find(query).sort({ createdAt: -1 });
  },

  async updateByIdAndOwner(id, ownerId, updates) {
    return Website.findOneAndUpdate({ _id: id, ownerId }, updates, {
      new: true,
      runValidators: true,
    });
  },

  async archiveByIdAndOwner(id, ownerId) {
    return Website.findOneAndUpdate(
      { _id: id, ownerId },
      { status: 'archived' },
      { new: true }
    );
  },

  // Used by the tracking collector (Phase 4) to resolve the public
  // websiteId embedded in the tracking script back to a website record.
  async findByWebsiteId(websiteId) {
    return Website.findOne({ websiteId });
  },

  // Phase 9: the reporting API is addressed by the PUBLIC websiteId (the
  // same identifier every analytics collection is keyed by), not the
  // internal `_id` Phase 3's website-management routes use — so it needs
  // its own owner-scoped lookup by that field. Same isolation strategy as
  // findByIdAndOwner above: the ownerId filter lives in the query itself,
  // not as an application-level check performed after an unscoped fetch.
  async findByWebsiteIdAndOwner(websiteId, ownerId) {
    return Website.findOne({ websiteId, ownerId });
  },
};
