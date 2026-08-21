/**
 * How many workholding tabs an outer routed profile should get.
 *
 * Replaces a bare `floor(perimeter / spacing)` divisor (routing.js's old
 * tab-count formula) with sane bounds on both ends:
 *
 *   - NEVER just 1 tab. A single tab isn't real holding - it's a pivot
 *     point the part can still rock/rotate around as the surrounding
 *     material falls away on the final pass. Found on a real generated
 *     file (a ~3"x2.2" plate, perimeter ~10.5", default 6" spacing): the
 *     old formula gave exactly 1 tab, centered right at the path's seam.
 *   - Capped so a large part doesn't get an excessive number of tabs -
 *     every tab is material the operator has to knock out and clean up by
 *     hand afterward; more tabs past a point isn't automatically safer,
 *     just more post-processing.
 *
 * Perimeter is the primary driver - same "spacing" concept routing.js's
 * existing tabSpacing param already uses (inches of edge per tab). Material
 * thickness, when given, is a real secondary factor: thin stock flexes and
 * chatters more easily near the end of a cut and benefits from tighter
 * spacing (more tabs) than thick stock, which is inherently more rigid on
 * its own. This is a coarse, clearly-bounded nudge (+/-25% spacing), not a
 * precise physics model - thickness alone doesn't determine real-world
 * holding strength (material, part shape, and mass all matter too), so
 * this is meant as a better starting point than a flat spacing constant,
 * not a substitute for looking at the actual part. Every input remains
 * fully overridable via the options below.
 */

export const MIN_TABS = 2;
export const MAX_TABS = 6;
export const DEFAULT_SPACING = 6; // inches of perimeter per tab - matches routing.js's existing tabSpacing default

const THIN_STOCK_THRESHOLD = 0.1; // inches - below this, tighten spacing (more tabs)
const THICK_STOCK_THRESHOLD = 0.375; // inches - above this, loosen spacing (fewer tabs)
const THICKNESS_SPACING_ADJUSTMENT = 0.25; // +/-25% spacing shift at the thresholds above

/**
 * @param {number} perimeter - inches, the tab-bearing contour's total path length
 * @param {Object} [options]
 * @param {number} [options.spacing] - target inches of perimeter per tab (default 6)
 * @param {number|null} [options.thickness] - material thickness in inches, if known
 * @param {number} [options.minTabs] - hard floor (default 2 - see file header)
 * @param {number} [options.maxTabs] - hard cap (default 6 - see file header)
 * @returns {number} recommended tab count, 0 only if perimeter/spacing is invalid
 */
export function recommendTabCount(perimeter, options = {}) {
  const { spacing = DEFAULT_SPACING, thickness = null, minTabs = MIN_TABS, maxTabs = MAX_TABS } = options;
  if (!(perimeter > 0) || !(spacing > 0)) return 0;

  let effectiveSpacing = spacing;
  if (thickness != null && thickness > 0) {
    if (thickness < THIN_STOCK_THRESHOLD) effectiveSpacing = spacing * (1 - THICKNESS_SPACING_ADJUSTMENT);
    else if (thickness > THICK_STOCK_THRESHOLD) effectiveSpacing = spacing * (1 + THICKNESS_SPACING_ADJUSTMENT);
  }

  const raw = Math.round(perimeter / effectiveSpacing);
  return Math.min(maxTabs, Math.max(minTabs, raw));
}
