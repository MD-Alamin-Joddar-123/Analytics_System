import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRate, calculateAverage, calculateConversionRates } from '../src/utils/analyticsFormulas.js';

describe('calculateRate', () => {
  test('computes a percentage from numerator/denominator', () => {
    assert.equal(calculateRate(12, 40), 30);
  });

  test('returns 0, never NaN or Infinity, for a zero denominator', () => {
    const rate = calculateRate(5, 0);
    assert.equal(rate, 0);
    assert.notEqual(rate, Infinity);
    assert.equal(Number.isNaN(rate), false);
  });

  test('returns 0 for a negative denominator', () => {
    assert.equal(calculateRate(5, -1), 0);
  });

  test('returns 0 for a non-finite numerator', () => {
    assert.equal(calculateRate(Infinity, 10), 0);
    assert.equal(calculateRate(NaN, 10), 0);
  });

  test('rounds to 2 decimal places by default', () => {
    assert.equal(calculateRate(1, 3), 33.33);
  });

  test('respects a custom decimals option', () => {
    assert.equal(calculateRate(1, 3, { decimals: 0 }), 33);
  });

  test('a zero numerator with a positive denominator is a clean 0, not -0 or NaN', () => {
    assert.equal(calculateRate(0, 40), 0);
    assert.ok(!Object.is(calculateRate(0, 40), -0));
  });
});

describe('calculateAverage', () => {
  test('computes a plain average', () => {
    assert.equal(calculateAverage(100, 4), 25);
  });

  test('returns 0 for a zero count (e.g. average order value with no orders)', () => {
    const avg = calculateAverage(5000, 0);
    assert.equal(avg, 0);
    assert.notEqual(avg, Infinity);
  });

  test('returns 0 for a negative count', () => {
    assert.equal(calculateAverage(100, -1), 0);
  });

  test('rounds when a decimals option is given', () => {
    assert.equal(calculateAverage(10, 3, { decimals: 2 }), 3.33);
  });

  test('returns the raw quotient when no decimals option is given', () => {
    assert.equal(calculateAverage(10, 3), 10 / 3);
  });
});

describe('calculateConversionRates', () => {
  test('computes all three named rates from raw counters', () => {
    const rates = calculateConversionRates({
      orders: 10,
      uniqueVisitors: 100,
      uniqueSessions: 50,
      checkoutStarted: 20,
      checkoutCompleted: 10,
    });
    assert.deepEqual(rates, {
      visitorConversionRate: 10,
      sessionConversionRate: 20,
      purchaseConversionRate: 50,
    });
  });

  test('every rate safely returns 0 when its denominator is 0 (empty range)', () => {
    const rates = calculateConversionRates({
      orders: 0,
      uniqueVisitors: 0,
      uniqueSessions: 0,
      checkoutStarted: 0,
      checkoutCompleted: 0,
    });
    assert.deepEqual(rates, { visitorConversionRate: 0, sessionConversionRate: 0, purchaseConversionRate: 0 });
    for (const value of Object.values(rates)) {
      assert.equal(Number.isFinite(value), true);
    }
  });
});
