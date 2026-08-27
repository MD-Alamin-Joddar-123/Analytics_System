export function toSafeWebsite(website) {
  if (!website) return null;

  const plain = typeof website.toJSON === 'function' ? website.toJSON() : { ...website };

  if (plain._id !== undefined && plain.id === undefined) {
    plain.id = String(plain._id);
    delete plain._id;
  }

  delete plain.ownerId;

  return plain;
}
