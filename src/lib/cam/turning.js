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
 *
 * SETUP MODES (params.setupMode, default 'single' - completely unchanged
 * behavior from before this option existed):
 *   'single'    - one continuous cut, cantilevered from the chuck the whole
 *                 way. Fine for parts that are short/stout enough relative
 *                 to their length not to deflect.
 *   'tailstock' - identical G-code to 'single' - a tailstock center is a
 *                 physical support, not a toolpath change - but adds a loud
 *                 header note reminding the operator to bring it up before
 *                 starting, since this mode exists specifically for parts
 *                 too long/thin to safely cantilever unsupported.
 *   'flip'      - genuinely different: splits the part at params.flipAt
 *                 (inches from the face) into two setups, chucked from
 *                 opposite ends, with a real program pause (M00) between
 *                 them for the operator to physically flip the stock,
 *                 re-chuck gripping the just-finished section, and re-zero
 *                 Z0 at the new face. See generateFlipTurningGcode below.
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
 * Appends roughing passes + a finishing pass for one already Z-normalized
 * profile (Z=0 at its own face, increasingly negative toward its own far
 * end) to `lines`. This is the exact body every setup mode shares - pulled
 * out unchanged from the single-setup path that already existed, so
 * 'single' mode's output is untouched by anything below, and 'flip' mode
 * can call it twice (once per chucking) without duplicating the logic.
 * Returns the pass count for stats.
 */
function appendSetupBody(lines, profile, { stockDiameter, stepDown, finishAllowance, feedRough, feedFinish, noseRadius }, finalLine = '(back to start clearance)') {
  const safeDiameter = stockDiameter + 0.1;
  const startZ = profile[0].z + 0.1; // 0.1" of clearance in front of this setup's face
  lines.push(`G00 X${fmt(safeDiameter)} Z${fmt(startZ)} (rapid to start clearance)`);

  const minTargetRadius = Math.min(...profile.map((p) => p.x)) + finishAllowance;
  let currentRadius = stockDiameter / 2;
  let passCount = 0;

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
  lines.push(`G00 Z${fmt(startZ)} ${finalLine}`);

  return passCount;
}

// Linear-interpolated radius at an arbitrary Z along an ordered profile -
// used to find the exact cut point at a flip boundary that doesn't happen
// to land exactly on an existing profile vertex.
function radiusAtZ(profile, z) {
  for (let i = 0; i < profile.length - 1; i += 1) {
    const a = profile[i], b = profile[i + 1];
    const lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z);
    if (z >= lo && z <= hi) {
      if (b.z === a.z) return a.x;
      const t = (z - a.z) / (b.z - a.z);
      return a.x + t * (b.x - a.x);
    }
  }
  // z is outside the profile's range entirely - clamp to the nearest end.
  return z <= profile[profile.length - 1].z ? profile[profile.length - 1].x : profile[0].x;
}

/**
 * @param {Array<{z:number, x:number}>} profile - ordered face-to-chuck points, x = radius
 * @param {Object} params
 *   stockDiameter, stepDown, finishAllowance, feedRough, feedFinish (required, inches/rev)
 *   surfaceSpeed (m/min, default 150), maxRpm (default 2500)
 *   noseRadius (inches, optional), toolNumber (default 1), programNumber (default 1000)
 *   units: 'in' | 'mm' (default 'in')
 *   setupMode: 'single' | 'tailstock' | 'flip' (default 'single')
 *   flipAt (required if setupMode='flip') - inches from the face where the
 *     part gets re-chucked; minGripLength (default 0.25") - safety floor,
 *     refuses to generate a flip plan that re-grips less material than this
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
    units = 'in',
    setupMode = 'single'
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

  if (setupMode === 'flip') {
    return generateFlipTurningGcode(profile, { stockDiameter, stepDown, finishAllowance, feedRough, feedFinish, surfaceSpeed, maxRpm, noseRadius, toolNumber, programNumber, units, flipAt: params.flipAt, minGripLength: params.minGripLength ?? 0.25 });
  }

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

  if (setupMode === 'tailstock') {
    const length = Math.abs(profile[profile.length - 1].z - profile[0].z);
    lines.push('(*** TAILSTOCK REQUIRED ***)');
    lines.push(`(This part is ${fmt(length, 3)}" long with a max diameter of ${fmt(maxProfileRadius * 2, 3)}" - too long/thin to safely)`);
    lines.push('(cantilever from the chuck alone. Bring up a live center in the tailstock to)');
    lines.push('(support the far end BEFORE starting the cut below.)');
  }

  const passCount = appendSetupBody(lines, profile, { stockDiameter, stepDown, finishAllowance, feedRough, feedFinish, noseRadius }, 'M05 (back to start clearance, spindle off)');

  lines.push('M09 (coolant off)');
  lines.push('M30 (program end)');
  lines.push('%');

  return {
    gcode: lines.join('\n'),
    stats: { roughingPasses: passCount, profilePoints: profile.length, maxRadius: maxProfileRadius, setupMode }
  };
}

/**
 * Two-setup ("flip-turning") program: cuts from the face to `flipAt`, pauses
 * for the operator to physically flip the stock and re-chuck gripping the
 * just-finished section, then cuts the remainder from the new face outward.
 *
 * Geometry: a lathe cuts a body of revolution, so a setup's toolpath only
 * depends on radius-as-a-function-of-distance-from-its-own-face - it doesn't
 * matter which way the stock physically points in the room. Setup 2's
 * profile is just the original profile's remainder, re-zeroed so the flip
 * point becomes its own Z=0 (a straight shift, z2 = originalZ + flipAt - no
 * reversal needed, since "distance from this setup's face" already
 * increases in the same direction the original profile array does).
 *
 * `profile` here is already the caller's Z-normalized profile (Z=0 at the
 * original face) - see generateTurningGcode above.
 */
function generateFlipTurningGcode(profile, params) {
  const { stockDiameter, stepDown, finishAllowance, feedRough, feedFinish, surfaceSpeed, maxRpm, noseRadius, toolNumber, programNumber, units, flipAt, minGripLength } = params;

  if (!flipAt || flipAt <= 0) {
    throw new Error('flipAt (inches from the face, where the part gets re-chucked) is required for setupMode "flip"');
  }
  const totalLength = Math.abs(profile[profile.length - 1].z - profile[0].z);
  if (flipAt >= totalLength) {
    throw new Error(`flipAt (${flipAt}") must be less than the part's total length (${fmt(totalLength, 3)}")`);
  }
  if (flipAt < minGripLength) {
    throw new Error(`flipAt (${flipAt}") re-grips less material than minGripLength (${minGripLength}") - too short to safely re-chuck. Pick a later flip point or lower minGripLength if you've verified it's actually safe for this part/chuck.`);
  }
  const remainingLength = totalLength - flipAt;
  if (remainingLength < minGripLength) {
    throw new Error(`Only ${fmt(remainingLength, 3)}" would remain past the flip point (${flipAt}") - too little material left to safely finish. Pick an earlier flip point.`);
  }

  const flipZ = -flipAt;

  // Setup 1: everything from the face (z=0) to the flip point (z=flipZ),
  // with an interpolated point exactly at the boundary appended.
  const setup1Profile = profile.filter((p) => p.z > flipZ).concat([{ x: radiusAtZ(profile, flipZ), z: flipZ }]);
  if (setup1Profile.length < 2) throw new Error('Flip point leaves too few profile points for setup 1 - pick a different flipAt');

  // Setup 2: everything from the flip point to the far end, re-zeroed so
  // the flip point becomes Z=0 in this setup's own frame (z2 = originalZ -
  // flipZ = originalZ + flipAt). Boundary point included so both setups
  // agree exactly on the diameter at the flip line.
  const setup2Profile = [{ x: radiusAtZ(profile, flipZ), z: flipZ }]
    .concat(profile.filter((p) => p.z < flipZ))
    .map((p) => ({ x: p.x, z: p.z - flipZ }));
  if (setup2Profile.length < 2) throw new Error('Flip point leaves too few profile points for setup 2 - pick a different flipAt');

  const lines = [...HEADER_WARNING, ''];
  lines.push('(*** TWO-SETUP (FLIP-TURNING) PROGRAM ***)');
  lines.push(`(Setup 1 cuts the first ${fmt(flipAt, 3)}" from the face. Setup 2 cuts the remaining)`);
  lines.push(`(${fmt(remainingLength, 3)}" after a manual re-chuck - see the pause partway through.)`);
  lines.push('%');
  lines.push(`O${programNumber} (AUTOCAM TURNING - FLIP SETUP 1 OF 2)`);
  lines.push(units === 'mm' ? 'G21 (metric)' : 'G20 (inch)');
  lines.push('G90 (absolute)');
  lines.push('G54 (work offset - verify before running)');
  lines.push(`T0${toolNumber}0${toolNumber} (tool change - verify tool/offset number)`);
  lines.push(`G50 S${maxRpm} (clamp max spindle RPM for constant surface speed)`);
  lines.push(`G96 S${surfaceSpeed} M03 (constant surface speed, spindle on)`);
  lines.push('G95 (feed per revolution)');

  const bodyParams = { stockDiameter, stepDown, finishAllowance, feedRough, feedFinish, noseRadius };
  const pass1 = appendSetupBody(lines, setup1Profile, bodyParams);

  lines.push('M05 (spindle off)');
  lines.push('M09 (coolant off)');
  lines.push('(*** RE-CHUCK REQUIRED - SETUP 2 OF 2 ***)');
  lines.push(`(1. Remove the part from the chuck.)`);
  lines.push('(2. Flip the part end-for-end.)');
  lines.push(`(3. Re-chuck, gripping the just-finished ${fmt(flipAt, 3)}" section - verify a secure, safe grip)`);
  lines.push('(   before proceeding. A partially-turned section may grip differently than raw stock.)');
  lines.push('(4. Re-zero the work offset (G54) so Z0 is at the NEW face - the flip line above.)');
  lines.push('(5. Only then press cycle start to resume.)');
  lines.push('M00 (program pause - do not resume until steps 1-4 above are complete)');
  lines.push('G54 (work offset - re-verify after re-chuck)');
  lines.push(`T0${toolNumber}0${toolNumber} (tool change - verify tool/offset number)`);
  lines.push(`G50 S${maxRpm} (clamp max spindle RPM for constant surface speed)`);
  lines.push(`G96 S${surfaceSpeed} M03 (constant surface speed, spindle back on)`);
  lines.push('G95 (feed per revolution)');

  const pass2 = appendSetupBody(lines, setup2Profile, bodyParams, 'M05 (back to start clearance, spindle off)');

  lines.push('M09 (coolant off)');
  lines.push('M30 (program end)');
  lines.push('%');

  const maxProfileRadius = Math.max(...profile.map((p) => p.x));
  return {
    gcode: lines.join('\n'),
    stats: {
      roughingPasses: pass1 + pass2,
      profilePoints: profile.length,
      maxRadius: maxProfileRadius,
      setupMode: 'flip',
      flipAt,
      setup1Length: flipAt,
      setup2Length: remainingLength
    }
  };
}
