// Short-lived in-memory cache for read-mostly Onshape GET responses. Onshape
// enforces a hard annual API call allocation (returns HTTP 402 once
// exceeded, and Spartan Robotics has historically run close to that limit -
// see the account usage alert this was added in response to), and the CAD
// pages re-fetch the same documents/assemblies/BOMs repeatedly on every
// load/mutation of a linked subsystem — without caching, that's a lot of
// avoidable repeat traffic for data that rarely changes between one page
// view and the next. Keyed per action since different actions have very
// different "how stale is acceptable" answers (a BOM changes when someone
// edits CAD; a shaded-view render of an already-published version never
// does). Process-local (resets on redeploy) - fine for a soft quota-saving
// measure, not a correctness requirement.
const onshapeResponseCache = new Map(); // cacheKey -> { data, expires }

export function getCached(cacheKey) {
  const cached = onshapeResponseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;
  return null;
}

export function setCached(cacheKey, data, ttlMs) {
  onshapeResponseCache.set(cacheKey, { data, expires: Date.now() + ttlMs });
}

// Test-only escape hatch - production code never needs to clear the cache mid-process.
export function clearOnshapeCache() {
  onshapeResponseCache.clear();
}

// TTL per action, chosen by how often the underlying data actually changes:
// - document-info / assembly-info / assembly-bom: can change any time someone
//   edits the CAD, so kept short - just long enough to absorb a page's own
//   redundant re-fetches, not so long that an active edit looks stale.
// - versions: only grows when someone explicitly creates a version/release -
//   much rarer than a live edit, so a longer TTL is safe.
// - version-details: a version's own metadata (e.g. "is this a release") is
//   effectively immutable once the version exists - safe to cache the longest.
// - shaded-views: an image render of a specific part. For a version/microversion
//   snapshot (wvm != 'w') the geometry can never change, but a workspace-mode
//   request COULD reflect an in-progress edit - use the same moderate TTL as
//   the metadata actions rather than trying to special-case wvm here.
export const CACHE_TTL_MS = {
  'document-info': 60_000,
  'assembly-info': 60_000,
  'assembly-bom': 60_000,
  versions: 5 * 60_000,
  'version-details': 30 * 60_000,
  'shaded-views': 5 * 60_000
};

export function buildCacheKey(action, params) {
  return `${action}:${params.join('|')}`;
}
