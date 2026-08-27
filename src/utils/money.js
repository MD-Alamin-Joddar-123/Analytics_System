const MINOR_UNIT_MULTIPLIER = 100;

export function toMinorUnits(majorAmount) {
  if (typeof majorAmount !== 'number' || !Number.isFinite(majorAmount)) {
    return undefined;
  }
  return Math.round(majorAmount * MINOR_UNIT_MULTIPLIER);
}

export function fromMinorUnits(minorAmount) {
  if (typeof minorAmount !== 'number' || !Number.isFinite(minorAmount)) {
    return undefined;
  }
  return minorAmount / MINOR_UNIT_MULTIPLIER;
}
