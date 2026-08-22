import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, isValidDomain } from '../src/utils/domain.js';

describe('normalizeDomain', () => {
  test('strips scheme, trailing slash, path, and query string', () => {
    assert.equal(normalizeDomain('https://example.com'), 'example.com');
    assert.equal(normalizeDomain('http://example.com/'), 'example.com');
    assert.equal(normalizeDomain('example.com'), 'example.com');
    assert.equal(normalizeDomain('EXAMPLE.com/shop?ref=1'), 'example.com');
  });

  test('does not merge "www." subdomains with the bare domain (documented behavior)', () => {
    assert.equal(normalizeDomain('https://www.example.com'), 'www.example.com');
    assert.notEqual(normalizeDomain('www.example.com'), normalizeDomain('example.com'));
  });

  test('drops a port', () => {
    assert.equal(normalizeDomain('http://example.com:3000'), 'example.com');
  });

  test('returns null for empty or non-string input', () => {
    assert.equal(normalizeDomain(''), null);
    assert.equal(normalizeDomain('   '), null);
    assert.equal(normalizeDomain(undefined), null);
    assert.equal(normalizeDomain(42), null);
  });
});

describe('isValidDomain', () => {
  test('accepts well-formed hostnames', () => {
    assert.equal(isValidDomain('example.com'), true);
    assert.equal(isValidDomain('shop.example.co.uk'), true);
  });

  test('rejects malformed hostnames', () => {
    assert.equal(isValidDomain('not a domain'), false);
    assert.equal(isValidDomain('no-dot-at-all'), false);
    assert.equal(isValidDomain(''), false);
    assert.equal(isValidDomain('-starts-with-hyphen.com'), false);
  });
});
