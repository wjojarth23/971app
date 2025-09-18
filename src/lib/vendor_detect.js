// Simple vendor detection helpers for AM (Andymark), WCP, and McMaster
// Respects environment variable to disable automatic vendor detection.
// Client-side SvelteKit envs: import.meta.env.PUBLIC_AUTO_VENDOR or VITE_AUTO_VENDOR
// Server-side: process.env.AUTO_VENDOR
function autoVendorEnabled() {
  try {
    // Client-side (Vite / SvelteKit)
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      const v = import.meta.env.PUBLIC_AUTO_VENDOR ?? import.meta.env.VITE_AUTO_VENDOR ?? import.meta.env.AUTO_VENDOR;
      if (typeof v !== 'undefined') return String(v).toLowerCase() !== 'false' && String(v) !== '0' && String(v).toLowerCase() !== 'no';
    }
  } catch (e) {
    // ignore
  }
  try {
    // Node/server-side
    if (typeof process !== 'undefined' && process.env) {
      const v = process.env.AUTO_VENDOR ?? process.env.VITE_AUTO_VENDOR ?? process.env.PUBLIC_AUTO_VENDOR;
      if (typeof v !== 'undefined') return String(v).toLowerCase() !== 'false' && String(v) !== '0' && String(v).toLowerCase() !== 'no';
    }
  } catch (e) {
    // ignore
  }
  return true; // default: enabled
}

export function detectVendorFromString(input) {
  // If auto vendor detection is disabled, always return null
  if (!autoVendorEnabled()) return null;

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

  // West Coast Products (normalize vendor to lowercase 'wcp' when used programmatically)
  if (wcpPattern.test(s) || /west ?coast|wcp/i.test(s)) {
    const part = extractPrefixedPart(s, ['WCP', 'WESTCOAST']);
    return { vendor: 'wcp', vendorCode: 'WCP', partNumber: part };
  }

  // McMaster heuristics: match common patterns and mention of mcmaster
  // Accept strings that contain 'mcmaster' or 'mcmaster-carr' or numeric part numbers with dashes
  const mcDirect = /mcmaster/i.test(s) || /mcmaster-carr/i.test(s);
  const mcLoose = /^(\s*\d{2,6}[-\dA-Za-z]*\s*)$/.test(s); // fairly permissive numeric-ish part
  if (mcDirect) {
    // try to extract a trailing part-like token
    const tokens = s.split(/\s+/).filter(Boolean);
    const candidate = tokens.length ? tokens[tokens.length - 1].replace(/[^0-9A-Za-z\-]/g, '') : null;
    return { vendor: 'McMaster-Carr', vendorCode: 'MCM', partNumber: candidate || null };
  }
  if (mcLoose) {
    const cleaned = s.replace(/[^0-9A-Za-z\-]/g, '').trim();
    return { vendor: 'McMaster-Carr', vendorCode: 'MCM', partNumber: cleaned || null };
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
