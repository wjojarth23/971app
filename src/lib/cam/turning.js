/**
 * Turning G-code generator - lathe roughing + finishing passes from a 2D
 * XZ profile. Ported and hardened from a reference algorithm sketch, targeting
 * Haas-style (Fanuc-dialect) lathe G-code: diameter-mode X, G96/G97 constant
 * surface speed, G95 feed-per-rev, G54 work offset, T-word tool change.
 *
 * NOT verified against real hardware or a simulator. Every generated file
 * carries a header warning to that effect - see HEADER_WARNING below.
 *
 * Roughing strategy: explicit step-down passes, each one tracing the entire
 * profile shape clamped to that pass's radius (an offset copy of the finish
 * profile, progressively closer to size), rather than a canned G71 cycle or
 * a single per-pass Z target. Tracing the whole profile every pass is what
 * makes this correct for any profile shape - an earlier version computed a
 * single Z depth per pass by intersecting the profile, which only produced
 * a correct cut for a profile that happened to be a simple monotonic taper
 * starting exactly at Z=0; real STEP-derived profiles aren't guaranteed to
 * look like that. Canned-cycle syntax also varies enough between controls
 * that explicit moves are safer to get right without hardware to test
 * against.
 *
 * KNOWN LIMITATION: the finishing pass applies a simple constant offset for
 * tool nose radius (when cam_tools.nose_radius is set), not true vector
 * compensation across corners/arcs. Fine for straight tapers; double-check
 * tight radii and chamfers before cutting.
 */

export const HEADER_WARNING = [
  '(===================================================================)',
  '(  AUTOCAM-GENERATED G-CODE - NOT VERIFIED ON REAL HARDWARE OR A   )',
  '(  SIMULATOR. Run this through a G-code simulator (e.g. ncviewer.com,)',
  '(  CAMotics) and do a supervised air-cut before running on material. )',
  '(===================================================================)'
];

function fmt(n, decimals = 4) {
  return Number(n).toFixed(decimals);
}

/**
 * @param {Array<{z:number, x:number}>} profile - ordered face-to-chuck points, x = radius
 * @param {Object} params
 *   stockDiameter, stepDown, finishAllowance, feedRough, feedFinish (required, inches/rev)
 *   surfaceSpeed (m/min, default 150), maxRpm (default 2500)
 *   noseRadius (inches, optional), toolNumber (default 1), programNumber (default 1000)
 *   units: 'in' | 'mm' (default 'in')
 */
export function generateTurningGcode(profile, params = {}) {
  if (!Array.isArray(profile) || profile.length < 2) {
    throw new Error('Turning profile needs at least 2 points');
  }
  const {
    stockDiameter,
    stepDown = 0.05,
    finishAllowance = 0.02,
    feedRough = 0.008,
    feedFinish = 0.004,
    surfaceSpeed = 150,
    maxRpm = 2500,
    noseRadius = 0,
    toolNumber = 1,
    programNumber = 1000,
    units = 'in'
  } = params;

  if (!stockDiameter || stockDiameter <= 0) throw new Error('stockDiameter is required and must be > 0');
  if (stepDown <= 0) throw new Error('stepDown must be > 0');

  const maxProfileRadius = Math.max(...profile.map((p) => p.x));
  if (stockDiameter / 2 < maxProfileRadius) {
    throw new Error(`Stock radius (${stockDiameter / 2}) is smaller than the profile's max radius (${maxProfileRadius}) - stock too small`);
  }

  // Everything below assumes lathe convention: Z=0 at the face (where the
  // tool starts, at a bit of clearance) and increasingly negative Z toward
  // the chuck. The profile as extracted from the STEP file is in the file's
  // own native coordinates instead (whatever origin the CAD model happened
  // to use), which are not guaranteed to start anywhere near 0 - shift so
  // the profile's first point (whichever end that is) sits at Z=0. Which
  // physical end that actually is (vs. which end goes in the chuck) can't be
  // determined from geometry alone - verify against the real part before
  // cutting.
  const zOrigin = profile[0].z;
  profile = profile.map((p) => ({ x: p.x, z: zOrigin - p.z }));

  const lines = [...HEADER_WARNING, ''];
  lines.push('%');
  lines.push(`O${programNumber} (AUTOCAM TURNING)`);
  lines.push(units === 'mm' ? 'G21 (metric)' : 'G20 (inch)');
  lines.push('G90 (absolute)');
  lines.push('G54 (work offset - verify before running)');
  lines.push(`T0${toolNumber}0${toolNumber} (tool change - verify tool/offset number)`);
  lines.push(`G50 S${maxRpm} (clamp max spindle RPM for constant surface speed)`);
  lines.push(`G96 S${surfaceSpeed} M03 (constant surface speed, spindle on)`);
  lines.push('G95 (feed per revolution)');
  const safeDiameter = stockDiameter + 0.1;
  const startZ = profile[0].z + 0.1; // 0.1" of clearance in front of the face
  lines.push(`G00 X${fmt(safeDiameter)} Z${fmt(startZ)} (rapid to start clearance)`);

  const minTargetRadius = Math.min(...profile.map((p) => p.x)) + finishAllowance;
  let currentRadius = stockDiameter / 2;
  let passCount = 0;

  // Each pass traces the *entire* profile shape, clamped so radius never
  // exceeds this pass's currentRadius - i.e. an offset copy of the finish
  // profile, progressively closer to size. This correctly sweeps the full
  // length of the part at every depth (unlike cutting to one single Z
  // target, which only works for a profile that happens to be a simple
  // monotonic taper starting exactly at the face) and handles any profile
  // shape, not just a single taper.
  lines.push('(--- ROUGHING PASSES ---)');
  while (currentRadius > minTargetRadius) {
    currentRadius = Math.max(currentRadius - stepDown, minTargetRadius);
    passCount += 1;
    if (passCount > 2000) throw new Error('Roughing pass count exceeded safety limit (2000) - check stepDown/profile');

    lines.push(`(-- roughing pass ${passCount}, radius ${fmt(currentRadius)}" --)`);
    lines.push(`G00 X${fmt(currentRadius * 2)} Z${fmt(startZ)}`);
    for (const pt of profile) {
      const cutRadius = Math.min(pt.x, currentRadius);
      lines.push(`G01 X${fmt(cutRadius * 2)} Z${fmt(pt.z)} F${fmt(feedRough, 5)}`);
    }
    lines.push(`G00 X${fmt(safeDiameter)} (retract clear of stock)`);
    lines.push(`G00 Z${fmt(startZ)} (back to start clearance)`);
  }

  lines.push('(--- FINISHING PASS ---)');
  if (noseRadius) {
    lines.push(`(NOTE: tool nose radius ${fmt(noseRadius, 3)}" is on file for this tool but NOT applied -)`);
    lines.push('(true nose-radius compensation needs per-segment vector offsets across arcs/)');
    lines.push('(corners, which this generator does not do yet. Verify chamfers/radii by hand.)');
  }
  lines.push(`G00 X0.0 Z${fmt(startZ)}`);
  for (const pt of profile) {
    lines.push(`G01 X${fmt(pt.x * 2)} Z${fmt(pt.z)} F${fmt(feedFinish, 5)}`);
  }

  lines.push(`G00 X${fmt(safeDiameter)} (retract clear of stock)`);
  lines.push(`G00 Z${fmt(startZ)} M05 (back to start clearance, spindle off)`);
  lines.push('M09 (coolant off)');
  lines.push('M30 (program end)');
  lines.push('%');

  return {
    gcode: lines.join('\n'),
    stats: { roughingPasses: passCount, profilePoints: profile.length, maxRadius: maxProfileRadius }
  };
}
