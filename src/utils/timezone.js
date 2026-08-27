const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export function isValidTimezone(value) {
  return typeof value === 'string' && VALID_TIMEZONES.has(value);
}
