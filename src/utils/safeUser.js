// Defense-in-depth transform: even though passwordHash is `select: false`
// on the schema and stripped by the model's toJSON transform, this ensures
// no code path can accidentally leak it in an API response.
export function toSafeUser(user) {
  if (!user) return null;

  const plain = typeof user.toJSON === 'function' ? user.toJSON() : { ...user };

  if (plain._id !== undefined && plain.id === undefined) {
    plain.id = String(plain._id);
    delete plain._id;
  }

  delete plain.passwordHash;

  return plain;
}
