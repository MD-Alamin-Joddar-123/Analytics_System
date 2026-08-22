import { User } from '../models/User.js';

// Exported as a plain object (rather than named exports) so individual
// methods can be swapped/mocked at the boundary in tests without a live
// database connection.
export const userRepository = {
  async findByEmail(email, { withPasswordHash = false } = {}) {
    const query = User.findOne({ email });
    if (withPasswordHash) query.select('+passwordHash');
    return query.exec();
  },

  async findById(id, { withPasswordHash = false } = {}) {
    const query = User.findById(id);
    if (withPasswordHash) query.select('+passwordHash');
    return query.exec();
  },

  async create({ name, email, passwordHash, role = 'user' }) {
    return User.create({ name, email, passwordHash, role });
  },

  async updateLastLogin(id) {
    return User.findByIdAndUpdate(id, { lastLoginAt: new Date() }, { new: true });
  },
};
