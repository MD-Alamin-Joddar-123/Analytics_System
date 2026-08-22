import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toMinorUnits, fromMinorUnits } from '../src/utils/money.js';

describe('money precision', () => {
  test('converts major units to integer minor units', () => {
    assert.equal(toMinorUnits(850), 85000);
    assert.equal(toMinorUnits(850.5), 85050);
    assert.equal(toMinorUnits(0), 0);
  });

  test('never produces a floating-point value — always an integer', () => {
    // The classic 0.1 + 0.2 problem: converting a value that would be
    // lossy as a float must still land on an exact integer.
    const result = toMinorUnits(19.99);
    assert.equal(Number.isInteger(result), true);
    assert.equal(result, 1999);
  });

  test('rounds to the nearest minor unit rather than truncating unpredictably', () => {
    assert.equal(toMinorUnits(10.005), 1001); // rounds, doesn't floor to 1000
    assert.equal(toMinorUnits(10.001), 1000);
  });

  test('round-trips through fromMinorUnits', () => {
    assert.equal(fromMinorUnits(toMinorUnits(85000)), 85000);
    assert.equal(fromMinorUnits(1999), 19.99);
  });

  test('returns undefined for non-finite or non-numeric input rather than throwing', () => {
    assert.equal(toMinorUnits(undefined), undefined);
    assert.equal(toMinorUnits(NaN), undefined);
    assert.equal(toMinorUnits('850'), undefined);
    assert.equal(fromMinorUnits(undefined), undefined);
  });
});
