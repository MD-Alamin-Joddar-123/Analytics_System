import mongoose from 'mongoose';
import { baseSchemaOptions } from './baseSchemaOptions.js';

export const USER_ROLES = ['user', 'admin'];
export const USER_STATUSES = ['active', 'suspended'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    // select: false keeps this out of query results by default; the
    // repository layer must explicitly request it (e.g. for login).
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'user',
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: 'active',
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    ...baseSchemaOptions,
    toJSON: {
      ...baseSchemaOptions.toJSON,
      transform(doc, ret, options) {
        baseSchemaOptions.toJSON.transform(doc, ret, options);
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

export const User = mongoose.model('User', userSchema);
