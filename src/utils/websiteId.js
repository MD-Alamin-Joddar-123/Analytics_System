import crypto from 'node:crypto';

// Public, non-sensitive tracking identifier — deliberately unrelated to the
// MongoDB _id (never derived from or convertible back to it). 8 random
// bytes as lowercase hex gives a 16-character, HTML/URL-safe, unambiguous
// id with a large enough keyspace (2^64) that collisions are practically
// impossible; the repository-level uniqueness check + unique index are the
// actual collision guarantee, this is just a low collision-probability
// generator.
export function generateWebsiteId() {
  return crypto.randomBytes(8).toString('hex');
}

const WEBSITE_ID_SHAPE = /^[a-f0-9]{16}$/;

// Single source of truth for the public id's shape, so the collector
// (Phase 4) validates incoming websiteId values against exactly what this
// generator produces, without duplicating the pattern.
export function isValidWebsiteId(value) {
  return typeof value === 'string' && WEBSITE_ID_SHAPE.test(value);
}
