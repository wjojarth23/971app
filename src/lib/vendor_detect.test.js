import { describe, it, expect } from 'vitest';
import { detectVendorFromString, buildVendorSearchUrl } from './vendor_detect.js';

describe('detectVendorFromString', () => {
  it('detects a WCP part by its WCP- prefix', () => {
    const result = detectVendorFromString('WCP-0941');
    expect(result).toEqual({ vendor: 'WCP', vendorCode: 'WCP', partNumber: 'WCP-0941' });
  });

  it('detects WCP by "west coast" mention', () => {
    expect(detectVendorFromString('West Coast Products gearbox').vendor).toBe('WCP');
  });

  it('detects an Andymark part by its AM- prefix and extracts the part number', () => {
    const result = detectVendorFromString('AM-3648');
    expect(result.vendor).toBe('Andymark');
    expect(result.partNumber).toBe('3648');
  });

  it('detects Andymark by name mention', () => {
    expect(detectVendorFromString('Andymark 6mm hex hub').vendor).toBe('Andymark');
  });

  it('detects a McMaster-Carr part number by its digit-letter-digit pattern', () => {
    const result = detectVendorFromString('90633A411');
    expect(result).toEqual({ vendor: 'McMaster-Carr', vendorCode: 'MCM', partNumber: '90633A411' });
  });

  it('detects McMaster-Carr by name mention and extracts a trailing token', () => {
    const result = detectVendorFromString('mcmaster 91251A537');
    expect(result.vendor).toBe('McMaster-Carr');
    expect(result.partNumber).toBe('91251A537');
  });

  it('checks WCP before Andymark when both patterns could plausibly apply', () => {
    // WCP is checked first per the function's own comment - sanity check that
    // ordering holds for a WCP-prefixed string that also happens to be Andymark shaped.
    expect(detectVendorFromString('WCP-0941').vendor).toBe('WCP');
  });

  it('returns null for a string matching no vendor pattern', () => {
    expect(detectVendorFromString('Custom Aluminum Bracket')).toBeNull();
  });

  it('returns null for empty/non-string input', () => {
    expect(detectVendorFromString('')).toBeNull();
    expect(detectVendorFromString(null)).toBeNull();
    expect(detectVendorFromString(undefined)).toBeNull();
  });
});

describe('buildVendorSearchUrl', () => {
  it('builds an Andymark search URL', () => {
    const url = buildVendorSearchUrl({ vendor: 'Andymark', vendorCode: 'AM', partNumber: '3648' });
    expect(url).toBe('https://www.andymark.com/search?keyword=3648');
  });

  it('builds a WCP search URL', () => {
    const url = buildVendorSearchUrl({ vendor: 'WCP', vendorCode: 'WCP', partNumber: 'WCP-0941' });
    expect(url).toBe('https://wcproducts.com/pages/search-results-page?q=WCP-0941');
  });

  it('builds a McMaster-Carr direct product URL', () => {
    const url = buildVendorSearchUrl({ vendor: 'McMaster-Carr', vendorCode: 'MCM', partNumber: '90633A411' });
    expect(url).toBe('https://www.mcmaster.com/products/90633A411/');
  });

  it('returns null when there is no detection or no part number', () => {
    expect(buildVendorSearchUrl(null)).toBeNull();
    expect(buildVendorSearchUrl({ vendor: 'WCP', vendorCode: 'WCP', partNumber: '' })).toBeNull();
  });

  it('URL-encodes the part number', () => {
    const url = buildVendorSearchUrl({ vendor: 'Andymark', vendorCode: 'AM', partNumber: 'a b/c' });
    expect(url).toContain(encodeURIComponent('a b/c'));
  });
});
