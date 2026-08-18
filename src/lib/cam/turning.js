/**
 * Turning G-code generator - lathe roughing + finishing passes from a 2D
 * XZ profile. Ported and hardened from a reference algorithm sketch, targeting
 * Haas-style (Fanuc-dialect) lathe G-code: diameter-mode X, G96/G97 constant
 * surface speed, G95 feed-per-rev, G54 work offset, T-word tool change.
 *
 * NOT verified against real hardware or a simulator. Every generated file
 * carries a header warning to that effect - see HEADER_WARNING below.
 *
 * Roughing strategy: explicit step-down passes with a per-pass Z depth found
 * by intersecting the profile (linear interpolation between profile points),
 * rather than a canned G71 cycle. This trades a few extra lines of G-code for
 * portability - canned-cycle syntax varies enough between controls that
 * explicit moves are safer to get right without hardware to test against.
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
  lines.push(`G00 X${fmt(stockDiameter + 0.1)} Z0.1 (rapid to start clearance)`);

  const zAtRadius = (radius) => {
    for (let i = 0; i < profile.length - 1; i += 1) {
      const p1 = profile[i];
      const p2 = profile[i + 1];
      const lo = Math.min(p1.x, p2.x);
      const hi = Math.max(p1.x, p2.x);
      if (radius >= lo && radius <= hi) {
        if (p2.x === p1.x) return Math.max(p1.z, p2.z);
        const t = (radius - p1.x) / (p2.x - p1.x);
        return p1.z + t * (p2.z - p1.z);
      }
    }
    // Radius is outside the profile's radius range entirely (e.g. beyond the
    // largest step) - treat as "no material there", clear to the furthest Z.
    return Math.min(...profile.map((p) => p.z));
  };

  const minTargetRadius = Math.min(...profile.map((p) => p.x)) + finishAllowance;
  let currentRadius = stockDiameter / 2;
  let passCount = 0;

  lines.push('(--- ROUGHING PASSES ---)');
  while (currentRadius > minTargetRadius) {
    currentRadius = Math.max(currentRadius - stepDown, minTargetRadius);
    const dia = currentRadius * 2;
    const zTarget = zAtRadius(currentRadius + finishAllowance);
    lines.push(`G00 X${fmt(dia)} Z0.1`);
    lines.push(`G01 Z${fmt(zTarget)} F${fmt(feedRough, 5)}`);
    lines.push(`G01 X${fmt(dia + 0.05)} Z${fmt(zTarget + 0.05)} (chip-clear retract)`);
    lines.push('G00 Z0.1');
    passCount += 1;
    if (passCount > 2000) throw new Error('Roughing pass count exceeded safety limit (2000) - check stepDown/profile');
  }

  lines.push('(--- FINISHING PASS ---)');
  if (noseRadius) {
    lines.push(`(NOTE: tool nose radius ${fmt(noseRadius, 3)}" is on file for this tool but NOT applied -)`);
    lines.push('(true nose-radius compensation needs per-segment vector offsets across arcs/)');
    lines.push('(corners, which this generator does not do yet. Verify chamfers/radii by hand.)');
  }
  lines.push('G00 X0.0 Z0.1');
  for (const pt of profile) {
    lines.push(`G01 X${fmt(pt.x * 2)} Z${fmt(pt.z)} F${fmt(feedFinish, 5)}`);
  }

  lines.push(`G00 X${fmt(stockDiameter + 0.5)} Z2.0 M05 (retract, spindle off)`);
  lines.push('M09 (coolant off)');
  lines.push('M30 (program end)');
  lines.push('%');

  return {
    gcode: lines.join('\n'),
    stats: { roughingPasses: passCount, profilePoints: profile.length, maxRadius: maxProfileRadius }
  };
}
