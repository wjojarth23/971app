import { describe, it, expect } from 'vitest';
import { normalizeIPToPrefix } from './ip_prefix.js';

describe('normalizeIPToPrefix', () => {
  it('extracts the first 3 octets of an IPv4 address', () => {
    expect(normalizeIPToPrefix('205.167.46.123')).toBe('205.167.46');
  });

  it('matches two IPv4 addresses on the same /24 to the same prefix', () => {
    expect(normalizeIPToPrefix('205.167.46.5')).toBe(normalizeIPToPrefix('205.167.46.250'));
  });

  it('does not match IPv4 addresses on different /24s', () => {
    expect(normalizeIPToPrefix('205.167.46.5')).not.toBe(normalizeIPToPrefix('205.167.47.5'));
  });

  it('expands :: shorthand and returns the first 4 hextets', () => {
    expect(normalizeIPToPrefix('2001:db8:1234:5678::1')).toBe('2001:db8:1234:5678');
  });

  it('handles a fully-expanded IPv6 address with no shorthand', () => {
    expect(normalizeIPToPrefix('2001:0db8:1234:5678:0000:0000:0000:0001')).toBe('2001:db8:1234:5678');
  });

  it('strips a zone ID before parsing (link-local IPv6)', () => {
    expect(normalizeIPToPrefix('fe80::1%eth0')).toBe('fe80:0:0:0');
  });

  it('handles leading :: (loopback-style shorthand)', () => {
    // ::1 -> 7 leading zero hextets + 1 -> first 4 hextets are all "0"
    expect(normalizeIPToPrefix('::1')).toBe('0:0:0:0');
  });

  it('pads a short IPv6 address with fewer than 4 hextets available before ::', () => {
    expect(normalizeIPToPrefix('2001:db8::')).toBe('2001:db8:0:0');
  });

  it('removes leading zeros from each hextet', () => {
    expect(normalizeIPToPrefix('0001:00db8:0234:5678::1')).toBe('1:db8:234:5678');
  });

  it('returns the input unchanged for non-string input', () => {
    expect(normalizeIPToPrefix(null)).toBeNull();
    expect(normalizeIPToPrefix(undefined)).toBeUndefined();
    expect(normalizeIPToPrefix('')).toBe('');
  });

  it('falls back to returning the (zone-stripped) input for unparseable garbage', () => {
    expect(normalizeIPToPrefix('not-an-ip')).toBe('not-an-ip');
  });
});
