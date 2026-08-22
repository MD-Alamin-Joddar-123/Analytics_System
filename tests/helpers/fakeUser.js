// Test fixture only — not a real Mongoose document. The repository layer
// is mocked in tests so the real User model/database is never touched.
export function makeFakeUser(overrides = {}) {
  const now = new Date().toISOString();
  return {
    _id: '507f1f77bcf86cd799439011',
    name: 'John Doe',
    email: 'john@example.com',
    passwordHash: '$2a$12$placeholderplaceholderplaceholderplace',
    role: 'user',
    status: 'active',
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
