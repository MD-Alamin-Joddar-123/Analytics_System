import { Website } from '../models/Website.js';

export const websiteRepository = {
  async create({ name, domain, websiteId, ownerId, timezone, currency }) {
    return Website.create({ name, domain, websiteId, ownerId, timezone, currency });
  },

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

  async findByWebsiteId(websiteId) {
    return Website.findOne({ websiteId });
  },

  async findByWebsiteIdAndOwner(websiteId, ownerId) {
    return Website.findOne({ websiteId, ownerId });
  },
};
