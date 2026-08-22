// Node's Intl implementation ships the full IANA time zone database, so we
// validate against it directly instead of maintaining our own static list.
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export function isValidTimezone(value) {
  return typeof value === 'string' && VALID_TIMEZONES.has(value);
}
