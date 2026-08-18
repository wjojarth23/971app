/**
 * Parses AutoCAM-generated G-code back into a flat list of 2D segments for
 * preview rendering. Deliberately narrow: only understands the G-code these
 * generators (turning.js, routing.js) actually emit - G00/G01 linear moves
 * with X/Y/Z words, no arcs (G02/G03), no canned cycles. Good enough for a
 * "does this look right" visual check, not a general G-code interpreter.
 *
 * Turning: G-code X is diameter - converted back to radius here. Segment
 * coordinates are {a: Z, b: radius}.
 * Routing: X/Y are used directly. Segment coordinates are {a: X, b: Y}.
 */
export function parseGcodeToolpath(gcode, operationType) {
  const lines = (gcode || '').split('\n');
  const segments = [];
  let cur = { x: null, y: null, z: null };
  let motion = null; // 'rapid' | 'feed'

  for (const rawLine of lines) {
    const line = rawLine.replace(/\(.*?\)/g, '').trim(); // strip (comments)
    if (!line || line.startsWith('%') || line.startsWith('O')) continue;

    const gMatch = line.match(/G0?([01])\b/);
    if (gMatch) motion = gMatch[1] === '0' ? 'rapid' : 'feed';
    if (!/^G0?[01]\b/.test(line) && !gMatch) {
      // Line has no G-word (e.g. a following block on a modal G0/G1) - still
      // apply coordinate updates below using the last-seen motion mode.
    }

    const xMatch = line.match(/X(-?[\d.]+)/);
    const yMatch = line.match(/Y(-?[\d.]+)/);
    const zMatch = line.match(/Z(-?[\d.]+)/);
    if (!xMatch && !yMatch && !zMatch) continue;
    if (!motion) continue; // no motion mode established yet (e.g. spindle/mode-only lines)

    const next = { ...cur };
    if (xMatch) next.x = parseFloat(xMatch[1]);
    if (yMatch) next.y = parseFloat(yMatch[1]);
    if (zMatch) next.z = parseFloat(zMatch[1]);

    const from = toPoint(cur, operationType);
    const to = toPoint(next, operationType);
    if (from && to && (from.a !== to.a || from.b !== to.b)) {
      segments.push({ from, to, rapid: motion === 'rapid' });
    }
    cur = next;
  }

  return segments;
}

function toPoint(state, operationType) {
  if (operationType === 'turning') {
    if (state.z === null || state.x === null) return null;
    return { a: state.z, b: state.x / 2 }; // diameter -> radius
  }
  if (state.x === null || state.y === null) return null;
  return { a: state.x, b: state.y };
}

export function toolpathBounds(segments) {
  if (segments.length === 0) return { minA: 0, maxA: 1, minB: 0, maxB: 1 };
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (const seg of segments) {
    for (const pt of [seg.from, seg.to]) {
      minA = Math.min(minA, pt.a); maxA = Math.max(maxA, pt.a);
      minB = Math.min(minB, pt.b); maxB = Math.max(maxB, pt.b);
    }
  }
  return { minA, maxA, minB, maxB };
}
