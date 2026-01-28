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
  const wcpPattern = /^WCP[.\-]/i;
  // McMaster-Carr pattern: 5-8 digits followed by a letter followed by 2-4 digits (e.g., 90633A411)
  const mcmasterPattern = /^\d{4,8}[A-Za-z]\d{2,4}$/;

  // West Coast Products - check first since it's most specific with WCP- prefix
  if (wcpPattern.test(s) || /west ?coast/i.test(s)) {
    // Return the full part number including prefix for WCP
    return { vendor: 'WCP', vendorCode: 'WCP', partNumber: s };
  }

  // Andymark
  if (amPattern.test(s) || /andymark/i.test(s)) {
    const part = extractPrefixedPart(s, ['AM', 'ANDYMARK']);
    return { vendor: 'Andymark', vendorCode: 'AM', partNumber: part };
  }

  // McMaster-Carr - specific pattern match for their part number format (e.g., 90633A411)
  if (mcmasterPattern.test(s)) {
    return { vendor: 'McMaster-Carr', vendorCode: 'MCM', partNumber: s };
  }

  // McMaster heuristics: match common patterns and mention of mcmaster
  const mcDirect = /mcmaster/i.test(s) || /mcmaster-carr/i.test(s);
  if (mcDirect) {
    // try to extract a trailing part-like token
    const tokens = s.split(/\s+/).filter(Boolean);
    const candidate = tokens.length ? tokens[tokens.length - 1].replace(/[^0-9A-Za-z\-]/g, '') : null;
    return { vendor: 'McMaster-Carr', vendorCode: 'MCM', partNumber: candidate || null };
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
  if (!pn) return null;
  
  if (detection.vendorCode === 'AM') return `https://www.andymark.com/search?keyword=${encodeURIComponent(pn)}`;
  // WCP: Use search results page with the full part number (e.g., WCP-0941)
  if (detection.vendorCode === 'WCP') return `https://wcproducts.com/pages/search-results-page?q=${encodeURIComponent(pn)}`;
  // McMaster-Carr: Direct product page URL using part number
  if (detection.vendorCode === 'MCM') return `https://www.mcmaster.com/products/${encodeURIComponent(pn)}/`;
  return null;
}
