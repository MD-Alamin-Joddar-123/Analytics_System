import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress } from '../src/utils/privateNetwork.js';

describe('isBlockedAddress — IPv4', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.169.254', // cloud metadata
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.0.1',
    '192.168.255.255',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ];
  for (const address of blocked) {
    test(`blocks ${address}`, () => {
      assert.equal(isBlockedAddress(address, 4), true);
    });
  }

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '11.0.0.1'];
  for (const address of allowed) {
    test(`allows genuinely public ${address}`, () => {
      assert.equal(isBlockedAddress(address, 4), false);
    });
  }
});

describe('isBlockedAddress — IPv6', () => {
  const blocked = ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1'];
  for (const address of blocked) {
    test(`blocks ${address}`, () => {
      assert.equal(isBlockedAddress(address, 6), true);
    });
  }

  test('allows a genuinely public IPv6 address', () => {
    assert.equal(isBlockedAddress('2606:4700:4700::1111', 6), false);
  });

  test('unwraps an IPv4-mapped IPv6 address and applies the IPv4 rules', () => {
    assert.equal(isBlockedAddress('::ffff:127.0.0.1', 6), true);
    assert.equal(isBlockedAddress('::ffff:169.254.169.254', 6), true);
    assert.equal(isBlockedAddress('::ffff:8.8.8.8', 6), false);
  });
});

describe('isBlockedAddress — malformed input', () => {
  test('refuses (blocks) an unparseable address rather than risk it', () => {
    assert.equal(isBlockedAddress('not-an-ip', 4), true);
    assert.equal(isBlockedAddress('', 4), true);
  });

  test('infers the family from the address shape when none is given', () => {
    assert.equal(isBlockedAddress('127.0.0.1'), true);
    assert.equal(isBlockedAddress('::1'), true);
    assert.equal(isBlockedAddress('8.8.8.8'), false);
  });
});
