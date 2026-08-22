import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';

export const WEBSITE_STATUSES = ['active', 'paused', 'archived'];

const websiteSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    // Normalized hostname only (no scheme/path/port) — see src/utils/domain.js
    // for the normalization rules. Not unique: the same hostname could
    // legitimately need to move between a customer's websites during
    // migration, and Phase 3 does not require cross-tenant domain
    // uniqueness. Indexed to support future domain-based lookups.
    domain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // Public tracking identifier — never the MongoDB _id. See
    // src/utils/websiteId.js. Unique + indexed since /api/collect (Phase 4)
    // will look websites up by this field on every tracked event.
    websiteId: {
      type: String,
      required: true,
      unique: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: WEBSITE_STATUSES,
      default: 'active',
    },
    timezone: {
      type: String,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
  },
  baseSchemaOptions
);

// Supports "list my websites, newest first" (GET /api/websites) and
// "list my websites filtered by status".
websiteSchema.index({ ownerId: 1, createdAt: -1 });
websiteSchema.index({ ownerId: 1, status: 1 });
websiteSchema.index({ domain: 1 });

export const Website = mongoose.model('Website', websiteSchema);
