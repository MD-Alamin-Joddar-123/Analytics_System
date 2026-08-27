import crypto from 'node:crypto';

export function generateWebsiteId() {
  return crypto.randomBytes(8).toString('hex');
}

const WEBSITE_ID_SHAPE = /^[a-f0-9]{16}$/;

export function isValidWebsiteId(value) {
  return typeof value === 'string' && WEBSITE_ID_SHAPE.test(value);
}
