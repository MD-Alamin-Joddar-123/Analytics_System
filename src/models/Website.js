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
    domain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
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


websiteSchema.index({ ownerId: 1, createdAt: -1 });
websiteSchema.index({ ownerId: 1, status: 1 });
websiteSchema.index({ domain: 1 });

export const Website = mongoose.model('Website', websiteSchema);
