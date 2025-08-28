// Simple vendor detection helpers for AM (Andymark), WCP, and McMaster
export function detectVendorFromString(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();

  // Patterns
  const amPattern = /^(AM|ANDYMARK)[.\-]/i;
  const wcpPattern = /^(WCP|WESTCOAST)[.\-]/i;

  // Andymark
  if (amPattern.test(s) || /andymark/i.test(s)) {
    const part = extractPrefixedPart(s, ['AM', 'ANDYMARK']);
    return { vendor: 'Andymark', vendorCode: 'AM', partNumber: part };
  }

  // West Coast Products
  if (wcpPattern.test(s) || /west ?coast|wcp/i.test(s)) {
    const part = extractPrefixedPart(s, ['WCP', 'WESTCOAST']);
    return { vendor: 'West Coast Products', vendorCode: 'WCP', partNumber: part };
  }

  // McMaster heuristic: starts with 3-4 digits, contains exactly one letter, ends with a digit
  // Example match: 123A4 or 1234B5
  const mcPattern = /^\s*(\d{3,4}[A-Za-z]\d+)\s*$/;
  const m = s.match(mcPattern);
  if (m) {
    return { vendor: 'McMaster-Carr', vendorCode: 'MCM', partNumber: m[1] };
  }

  // Also accept if the string contains 'mcmaster' or 'mcmaster-carr'
  if (/mcmaster/i.test(s) || /mcmaster-carr/i.test(s)) {
    return { vendor: 'McMaster-Carr', vendorCode: 'MCM', partNumber: null };
  }

  return null;
}

function extractPrefixedPart(s, prefixes) {
  for (const p of prefixes) {
    const rx = new RegExp(`^${p}[.\-](.+)`, 'i');
    const m = s.match(rx);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

export function buildVendorSearchUrl(detection) {
  if (!detection || !detection.vendor) return null;
  const pn = detection.partNumber || '';
  if (detection.vendorCode === 'AM') return `https://www.andymark.com/search?keyword=${encodeURIComponent(pn)}`;
  if (detection.vendorCode === 'WCP') return `https://www.wcproducts.com/search?query=${encodeURIComponent(pn)}`;
  if (detection.vendorCode === 'MCM') return `https://www.mcmaster.com/search/?q=${encodeURIComponent(pn)}`;
  return null;
}
