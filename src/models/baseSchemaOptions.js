// Shared Mongoose schema options for all future collections.
// Ensures consistent timestamps, JSON shape, and versioning across the schema.
export const baseSchemaOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
  },
};

// Every website-scoped collection (Visitor, Session, Event, Product, Order,
// DailyAnalytics, ProductAnalytics, FunnelAnalytics) must include a
// `websiteId` field referencing the Website model to enforce multi-tenant
// data isolation. See docs/DATABASE_ARCHITECTURE.md for the full strategy.
export const websiteScopedIndexField = 'websiteId';
