import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}
