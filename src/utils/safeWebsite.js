// Serializes a Website document for API responses. ownerId is intentionally
// omitted: it's implicit (every website in a response is always the
// authenticated caller's own), so there's no reason to echo the raw
// reference back to the client.
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
