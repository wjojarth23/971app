/**
 * Normalize an IP address to its network prefix for attendance location
 * matching. IPv4: first 3 octets (e.g. "205.167.46"). IPv6: first 4 hextets
 * (e.g. "2001:db8:1234:5678"). See src/routes/api/attendance/+server.js's
 * own header comment for why prefix matching is used instead of full IPs.
 *
 * @param {string} ip - The full IP address
 * @returns {string} The normalized network prefix
 */
export function normalizeIPToPrefix(ip) {
  if (!ip || typeof ip !== 'string') return ip;

  // Strip zone ID (e.g., fe80::1%eth0 → fe80::1)
  const noZone = ip.split('%')[0];

  // IPv4: Extract first 3 octets
  const ipv4Match = noZone.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (ipv4Match) {
    return ipv4Match[1];
  }

  // IPv6: Extract first 4 hextets
  try {
    let hextets;

    // Handle :: shorthand expansion
    if (noZone.includes('::')) {
      const parts = noZone.split('::');
      const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
      const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];
      const missing = 8 - (left.length + right.length);
      hextets = [...left, ...new Array(missing).fill('0'), ...right];
    } else {
      hextets = noZone.split(':').filter(Boolean);
    }

    if (hextets.length === 0) return noZone;

    // Normalize each hextet (remove leading zeros)
    const first4 = hextets.slice(0, 4).map((h) => h.replace(/^0+/, '') || '0');
    return first4.join(':');
  } catch (e) {
    return noZone;
  }
}
