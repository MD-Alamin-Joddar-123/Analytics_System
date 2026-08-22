// Test fixture only — not a real Mongoose document. The repository layer
// is mocked in tests so the real Website model/database is never touched.
export function makeFakeWebsite(overrides = {}) {
  const now = new Date().toISOString();
  return {
    _id: '66a1f0c9e1a2b3c4d5e6f7a8',
    name: 'My Store',
    domain: 'example.com',
    websiteId: 'abc123deadbeef01',
    ownerId: '507f1f77bcf86cd799439011',
    status: 'active',
    timezone: 'Asia/Dhaka',
    currency: 'BDT',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeFakeUserRecord(id, overrides = {}) {
  return {
    _id: id,
    name: 'Test User',
    email: `${id}@example.com`,
    role: 'user',
    status: 'active',
    ...overrides,
  };
}
