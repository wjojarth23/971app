/**
 * Some local/sandboxed dev environments block the OS-level resolver
 * (getaddrinfo, what Node's dns.lookup uses by default and what
 * http/https/fetch/undici all rely on internally) while still allowing
 * direct UDP DNS queries (dns.resolve4/resolve6, the c-ares path) - `nslookup`
 * and `ping` work in that situation, but `curl`/`fetch` fail with
 * "getaddrinfo ENOTFOUND" or a bare "TypeError: fetch failed", because they
 * go through the blocked path. This showed up as CAM generation always
 * timing out server-side (fetch to Supabase failing) while the browser,
 * which isn't subject to the same restriction, worked fine for everything
 * client-side.
 *
 * This patches dns.lookup to fall back to dns.resolve4/6 only when the
 * normal getaddrinfo lookup actually fails - a pure no-op when the system
 * resolver already works (i.e. everywhere except this specific failure
 * mode), so it's safe to import unconditionally in both dev and production.
 *
 * Must be imported before anything else does a network request - imported
 * first thing in src/hooks.server.js for that reason.
 */
import dns from 'node:dns';

const systemLookup = dns.lookup.bind(dns);
const resolve4 = dns.resolve4.bind(dns);
const resolve6 = dns.resolve6.bind(dns);

function normalizeArgs(options, callback) {
  if (typeof options === 'function') return [{}, options];
  return [options || {}, callback];
}

function udpLookup(hostname, options, callback) {
  const wantsAll = !!options.all;
  const family = options.family === 6 ? 6 : 4;
  const resolver = family === 6 ? resolve6 : resolve4;
  resolver(hostname, (err, addresses) => {
    if (err || !addresses?.length) {
      callback(err || Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname }));
      return;
    }
    if (wantsAll) callback(null, addresses.map((address) => ({ address, family })));
    else callback(null, addresses[0], family);
  });
}

dns.lookup = (hostname, options, callback) => {
  const [opts, cb] = normalizeArgs(options, callback);
  systemLookup(hostname, opts, (err, ...rest) => {
    if (!err) return cb(null, ...rest);
    udpLookup(hostname, opts, cb);
  });
};
