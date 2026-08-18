/**
 * Routing G-code generator - 2D profile/pocket cutting from closed contours
 * (extracted from a STEP file's flat face - see stepProfile.js), targeting
 * LinuxCNC-style G-code (matches this app's app-wide .ngc requirement):
 * G20/G21, G17 (XY plane), G94 (feed/min), M03/M05, M30.
 *
 * NOT verified against real hardware or a simulator. Every generated file
 * carries a header warning to that effect - see HEADER_WARNING in turning.js
 * (same text, reused here for consistency).
 *
 * KNOWN LIMITATION: tool-radius compensation is done with a hand-rolled
 * polygon offset (edge-normal offset + miter join at vertices), not a
 * robust general polygon-clipping library. It handles typical convex/mildly
 * concave profiles fine; on very tight concave features the offset can
 * self-intersect without being cleaned up. Inspect the toolpath (or run it
 * through a simulator) before cutting anything with sharp internal corners
 * smaller than the tool diameter.
 *
 * MULTI-TOOL SUPPORT: pass params.toolSequence (ordered array of tool specs,
 * primary/largest tool first) to cut different contours with different
 * tools - each contour is assigned to the *first* tool in the sequence that
 * geometrically fits it (reusing the same throat-distance check offsetPolygon
 * already does), falling through to smaller tools only where the primary
 * tool physically can't reach (e.g. a hole narrower than its diameter).
 * This is deliberately NOT true rest-machining (recutting the leftover
 * material a larger tool couldn't clear on the same contour) - that needs
 * robust polygon-boolean geometry this file doesn't have. What it does do:
 * let a job use a strong/fast primary bit for everything that fits it, and
 * automatically fall back to a smaller detail bit only for the features
 * that need one, in a single program. See implementations/toolchange-gcode-plan.md.
 *
 * Every tool change assumes NO automatic tool-length compensation (no
 * confirmed tool setter on the router this targets) - each change is a
 * genuine program pause (M00) instructing the operator to load the new bit
 * and RE-TOUCH OFF Z0 before resuming. If this router does get a tool
 * setter later, that assumption (and the block below) needs revisiting.
 */

import { HEADER_WARNING } from './turning.js';

function fmt(n, decimals = 4) {
  return Number(n).toFixed(decimals);
}

function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    sum += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y;
  }
  return sum / 2;
}

// Ensures a closed polygon (last point == first) winds counter-clockwise.
function ensureCCW(points) {
  const pts = points[0].x === points[points.length - 1].x && points[0].y === points[points.length - 1].y
    ? points
    : points.concat([points[0]]);
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

function normalize(vx, vy) {
  const len = Math.hypot(vx, vy) || 1;
  return [vx / len, vy / len];
}

// Line-line intersection of two infinite lines, each defined by a point + direction.
function intersectLines(p1, d1, p2, d2) {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const t = ((p2.x - p1.x) * d2[1] - (p2.y - p1.y) * d2[0]) / denom;
  return { x: p1.x + d1[0] * t, y: p1.y + d1[1] * t };
}

function pointToSegmentDistance(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq)) : 0;
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

// Smallest distance from the polygon's centroid to any of its edges - a
// practical proxy for the tightest constriction in the shape. Used to catch
// "tool physically can't fit in this feature" before silently emitting a
// collapsed/garbage toolpath (e.g. a hole smaller than the tool diameter),
// and (for multi-tool jobs) to decide whether a contour needs a smaller tool.
function minThroatDistance(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let min = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    min = Math.min(min, pointToSegmentDistance({ x: cx, y: cy }, pts[i], pts[(i + 1) % pts.length]));
  }
  return min;
}

/**
 * Offsets a closed CCW polygon by `distance` (positive = outward/grows the
 * loop, negative = inward/shrinks it). Simple edge-normal + miter-join
 * offset - see file-level KNOWN LIMITATION.
 */
export function offsetPolygon(points, distance) {
  const ccw = ensureCCW(points);
  const pts = ccw.slice(0, -1); // drop duplicate closing point for the math, re-close at the end
  const n = pts.length;
  if (n < 3) throw new Error('Polygon needs at least 3 vertices to offset');
  if (distance === 0) return ccw;

  if (distance < 0) {
    const throat = minThroatDistance(pts);
    if (Math.abs(distance) >= throat) {
      throw new Error(
        `Feature is too small for this tool: tool radius ${Math.abs(distance).toFixed(4)}" but the tightest ` +
        `point in this contour is only ~${throat.toFixed(4)}" from center - use a smaller tool or drop this hole/pocket`
      );
    }
  }

  const edges = [];
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const [dx, dy] = normalize(b.x - a.x, b.y - a.y);
    // Outward normal for a CCW polygon is (dy, -dx).
    const nx = dy;
    const ny = -dx;
    edges.push({
      a: { x: a.x + nx * distance, y: a.y + ny * distance },
      dir: [dx, dy]
    });
  }

  const MAX_MITER = Math.abs(distance) * 8; // clamp runaway spikes on sharp concave corners
  const offset = [];
  for (let i = 0; i < n; i += 1) {
    const prev = edges[(i - 1 + n) % n];
    const cur = edges[i];
    const hit = intersectLines(prev.a, prev.dir, cur.a, cur.dir);
    const fallback = { x: (prev.a.x + cur.a.x) / 2, y: (prev.a.y + cur.a.y) / 2 };
    const candidate = hit || fallback;
    const dFromOriginal = Math.hypot(candidate.x - pts[i].x, candidate.y - pts[i].y);
    offset.push(dFromOriginal > MAX_MITER ? fallback : candidate);
  }
  offset.push(offset[0]);
  return offset;
}

function pathLength(path) {
  let len = 0;
  for (let i = 0; i < path.length - 1; i += 1) len += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  return len;
}

// Evenly spaces tab zones (as [startDist, endDist] along the path) every
// `spacing` inches of perimeter, each `width` inches wide.
function buildTabZones(perimeter, width, spacing) {
  if (perimeter <= 0) return [];
  const count = Math.max(1, Math.floor(perimeter / spacing));
  const zones = [];
  for (let i = 0; i < count; i += 1) {
    const center = (perimeter / count) * i;
    zones.push([Math.max(0, center - width / 2), Math.min(perimeter, center + width / 2)]);
  }
  return zones;
}

// Walks the path emitting G01 moves at full cut depth, except inside a tab
// zone where depth is clamped so tabHeight of material is left uncut - only
// on the FINAL pass (earlier passes stay above the tab height entirely and
// cut normally, since they don't reach that deep anyway once clamped).
function emitContourPass(lines, path, passDepth, targetDepth, tabZones, tabHeight, feedRate) {
  let dist = 0;
  const isFinalPass = passDepth >= targetDepth - 1e-9;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const midDist = dist + segLen / 2;
    const inTab = isFinalPass && tabZones.some(([s, e]) => midDist >= s && midDist <= e);
    const cutDepth = inTab ? Math.max(0, targetDepth - tabHeight) : passDepth;
    lines.push(`G01 X${fmt(b.x)} Y${fmt(b.y)} Z${fmt(-cutDepth)} F${fmt(feedRate)}`);
    dist += segLen;
  }
}

// Cuts one contour (all step-down passes + tabs) with one tool's params.
// Shared by both the single-tool and multi-tool code paths.
function cutContour(lines, contour, toolRadius, toolParams, safeZ) {
  const { stepDown, targetDepth, tabWidth, tabHeight, tabSpacing, feedRate, plungeRate } = toolParams;
  const path = offsetPolygon(contour.points, contour.isHole ? -toolRadius : toolRadius);
  const perimeter = pathLength(path);
  const tabZones = tabSpacing > 0 ? buildTabZones(perimeter, tabWidth, tabSpacing) : [];

  lines.push(`(--- ${contour.isHole ? 'HOLE' : 'OUTER'} CONTOUR, perimeter ~${fmt(perimeter, 2)}" ---)`);
  lines.push(`G00 X${fmt(path[0].x)} Y${fmt(path[0].y)} (rapid to start)`);

  let depth = 0;
  while (depth < targetDepth) {
    depth = Math.min(depth + stepDown, targetDepth);
    lines.push(`(-- pass at Z-${fmt(depth)} --)`);
    lines.push(`G01 Z${fmt(-depth)} F${fmt(plungeRate)} (plunge)`);
    emitContourPass(lines, path, depth, targetDepth, tabZones, tabHeight, feedRate);
  }
  lines.push(`G00 Z${fmt(safeZ)} (retract)`);
  return { perimeter, tabZoneCount: tabZones.length };
}

const TOOL_STEP_DEFAULTS = { stepDown: 0.1, tabWidth: 0.25, tabHeight: 0.06, tabSpacing: 6, feedRate: 40, plungeRate: 15, spindleSpeed: 16000 };

/**
 * For each contour, finds the first (in given order) tool whose radius
 * actually fits - i.e. offsetPolygon doesn't throw the "too small" error.
 * Sequence should be ordered primary/largest tool first, detail/smallest
 * tools after, so a contour only falls through to a smaller tool when the
 * bigger one genuinely can't reach it (e.g. a hole narrower than its bit).
 * Throws if no tool in the sequence fits a given contour.
 */
function assignContoursToTools(contours, toolSequence) {
  const assignments = []; // [{ contour, toolIndex }]
  for (const contour of contours) {
    let assigned = -1;
    for (let i = 0; i < toolSequence.length; i += 1) {
      const radius = toolSequence[i].toolDiameter / 2;
      if (!contour.isHole) { assigned = i; break; } // outer contour always fits the first tool that reaches it geometrically; only holes can be "too small"
      try {
        offsetPolygon(contour.points, -radius);
        assigned = i;
        break;
      } catch {
        continue; // this tool doesn't fit - try the next (smaller) one
      }
    }
    if (assigned === -1) {
      const diameters = toolSequence.map((t) => `${t.toolDiameter}"`).join(', ');
      throw new Error(`No tool in the sequence (${diameters}) fits one of this part's holes - add a smaller tool or drop that hole`);
    }
    assignments.push({ contour, toolIndex: assigned });
  }
  return assignments;
}

/**
 * @param {Array<{points: Array<{x,y}>, isHole: boolean}>} contours
 * @param {Object} params
 *   Single-tool mode (unchanged, backward compatible):
 *     toolDiameter (required, inches), stepDown (default 0.1), targetDepth (required)
 *     tabWidth (default 0.25), tabHeight (default 0.06), tabSpacing (default 6, inches; 0 = no tabs)
 *     feedRate (in/min, default 40), plungeRate (in/min, default 15), spindleSpeed (rpm, default 16000)
 *   Multi-tool mode: params.toolSequence = [{ toolDiameter, toolNumber, label,
 *     stepDown, tabWidth, tabHeight, tabSpacing, feedRate, plungeRate, spindleSpeed }, ...],
 *     primary/largest tool first. targetDepth still comes from the top-level
 *     params (shared - it's the material thickness, not a per-tool choice).
 *   Both modes: targetDepth (required), safeZ (default 0.25), units: 'in' | 'mm' (default 'in')
 */
export function generateRoutingGcode(contours, params = {}) {
  if (!Array.isArray(contours) || contours.length === 0) {
    throw new Error('Routing needs at least one closed contour');
  }
  const { targetDepth, safeZ = 0.25, units = 'in' } = params;
  if (!targetDepth || targetDepth <= 0) throw new Error('targetDepth is required and must be > 0');

  const lines = [...HEADER_WARNING, ''];
  lines.push(units === 'mm' ? 'G21 (metric)' : 'G20 (inch)');
  lines.push('G90 (absolute)');
  lines.push('G17 (XY plane)');
  lines.push('G94 (feed per minute)');
  lines.push('G54 (work offset - verify before running)');

  const hasSequence = Array.isArray(params.toolSequence) && params.toolSequence.length > 0;

  if (!hasSequence) {
    // Single-tool path, unchanged from before multi-tool support existed.
    const { toolDiameter, stepDown = 0.1, tabWidth = 0.25, tabHeight = 0.06, tabSpacing = 6, feedRate = 40, plungeRate = 15, spindleSpeed = 16000 } = params;
    if (!toolDiameter || toolDiameter <= 0) throw new Error('toolDiameter is required and must be > 0');
    lines.push(`S${spindleSpeed} M03 (spindle on)`);
    lines.push(`G00 Z${fmt(safeZ)} (safe height)`);

    let totalTabZones = 0;
    for (const contour of contours) {
      const { tabZoneCount } = cutContour(lines, contour, toolDiameter / 2, { stepDown, targetDepth, tabWidth, tabHeight, tabSpacing, feedRate, plungeRate }, safeZ);
      totalTabZones += tabZoneCount;
    }
    lines.push('M05 (spindle off)');
    lines.push('M30 (program end)');
    return { gcode: lines.join('\n'), stats: { contours: contours.length, tabZones: totalTabZones, targetDepth, toolChanges: 0 } };
  }

  // Multi-tool path.
  const toolSequence = params.toolSequence.map((t) => ({ ...TOOL_STEP_DEFAULTS, ...t }));
  for (const t of toolSequence) {
    if (!t.toolDiameter || t.toolDiameter <= 0) throw new Error('Every tool in the sequence needs a toolDiameter > 0');
  }
  const assignments = assignContoursToTools(contours, toolSequence);

  lines.push('(--- TOOL PLAN - stage these before starting ---)');
  toolSequence.forEach((t, i) => {
    const count = assignments.filter((a) => a.toolIndex === i).length;
    lines.push(`(  ${i + 1}. ${t.label || `${fmt(t.toolDiameter, 3)}" tool`}${t.toolNumber ? ` (T${t.toolNumber})` : ''} - ${count} contour${count === 1 ? '' : 's'} )`);
  });

  let totalTabZones = 0;
  let toolChanges = 0;
  let firstUsedTool = true;
  for (let toolIndex = 0; toolIndex < toolSequence.length; toolIndex += 1) {
    const contoursForTool = assignments.filter((a) => a.toolIndex === toolIndex).map((a) => a.contour);
    if (contoursForTool.length === 0) continue; // nothing needs this tool on this part - skip it, no pointless tool change

    const tool = toolSequence[toolIndex];
    if (firstUsedTool) {
      lines.push(`(--- TOOL 1: ${tool.label || `${fmt(tool.toolDiameter, 3)}" tool`}${tool.toolNumber ? ` (T${tool.toolNumber})` : ''} - load before starting ---)`);
      lines.push(`S${tool.spindleSpeed} M03 (spindle on)`);
      lines.push(`G00 Z${fmt(safeZ)} (safe height)`);
      firstUsedTool = false;
    } else {
      toolChanges += 1;
      lines.push(`G00 Z${fmt(safeZ)} (retract clear before tool change)`);
      lines.push('M05 (spindle off)');
      lines.push(`M00 (TOOL CHANGE: load ${tool.label || `${fmt(tool.toolDiameter, 3)}" tool`}${tool.toolNumber ? ` - T${tool.toolNumber}` : ''}, then RE-TOUCH OFF Z0 before resuming - no automatic tool length compensation assumed)`);
      lines.push(`S${tool.spindleSpeed} M03 (spindle back on)`);
      lines.push(`G00 Z${fmt(safeZ)} (safe height)`);
    }

    for (const contour of contoursForTool) {
      const { tabZoneCount } = cutContour(lines, contour, tool.toolDiameter / 2, { ...tool, targetDepth: tool.targetDepth || targetDepth }, safeZ);
      totalTabZones += tabZoneCount;
    }
  }

  lines.push('M05 (spindle off)');
  lines.push('M30 (program end)');

  return {
    gcode: lines.join('\n'),
    stats: { contours: contours.length, tabZones: totalTabZones, targetDepth, toolChanges, toolsUsed: [...new Set(assignments.map((a) => a.toolIndex))].length }
  };
}
