/**
 * Extracts 2D CAM geometry directly from a STEP file's triangulated mesh via
 * occt-import-js (already a dependency here, used by CadViewer.svelte for
 * the 3D viewer - this module reuses the exact same library, just server-side
 * in Node instead of the browser). No DXF, no separate 2D drawing needed.
 *
 * Both extractors work off the mesh geometry only (positions + triangle
 * indices + per-face triangle ranges), not true B-rep surfaces - occt-import-js
 * only exposes the triangulated result, not raw OpenCascade topology. That's
 * enough for what's needed here:
 *
 * - Turning: lathe parts are physically solids of revolution (that's the only
 *   thing a lathe can produce), so instead of requiring a specific modeling
 *   axis, this auto-detects the part's long axis (the bounding box's largest
 *   span - real turned parts are always much longer than they are wide) and
 *   uses it as the length axis, centering the radius calculation on the
 *   bounding-box midpoint of the other two axes. Works regardless of which
 *   way the part happens to be oriented in the STEP file.
 * - Routing: finds the largest planar face on the part (in ANY orientation,
 *   not just facing a particular axis - it's whichever face has the most
 *   area, verified genuinely flat by checking all its triangles share one
 *   normal), traces its triangle-boundary edges into closed 2D loops (outer
 *   profile + holes) projected into that face's own plane, and reads
 *   material thickness as the part's full extent along that face's normal.
 *
 * Earlier versions of both of these assumed the part was modeled with a
 * specific axis (Z) aligned to the tool axis / face normal. Real STEP
 * exports (Onshape in particular) very often don't follow that convention -
 * a "Hex Shaft" test part came through with its long axis on X, and a flat
 * routed part came through with its thin (thickness) axis on X instead of Z,
 * which silently produced a face normal to Z instead of the real flat face -
 * cutting the wrong outline at ~8x the real material thickness. Auto-
 * detecting orientation from the geometry itself removes that whole class of
 * silent-wrong-output failure instead of requiring users to know and follow
 * an arbitrary modeling convention.
 */

// occt-import-js is Emscripten-compiled WASM; its default loader finds its
// .wasm binary via fs.readFileSync() relative to __dirname, which breaks
// once a bundler relocates the code away from its original node_modules
// layout - __dirname no longer points anywhere near the real file. A
// require.resolve()-based fix (tried first, see git history) still failed
// in production: Vercel's build-time file tracer doesn't detect that
// runtime-resolved dependency and never includes the .wasm binary in the
// deployed function bundle at all ("Cannot find module ...occt-import-js.wasm",
// confirmed directly from a real Vercel function error). That fallback still
// works fine locally (plain Node, or `vite dev`), so it stays as the default
// for scripts/test-cam-extraction.mjs and local dev - but the server route
// (src/routes/api/cam-generate/+server.js) now fetches the same WASM binary
// CadViewer.svelte already serves successfully client-side (a real Vite
// build asset with a real URL, not a traced filesystem dependency) and
// passes the bytes in directly via `wasmBinaryOverride`, sidestepping the
// tracer issue entirely. See implementations/vercel-cam-generate-timeout-fix.md.
let occtPromise = null;
async function getOcct(wasmBinaryOverride) {
  if (!occtPromise) {
    const { default: occtimportjsFactory } = await import('occt-import-js');
    if (wasmBinaryOverride) {
      occtPromise = occtimportjsFactory({ wasmBinary: wasmBinaryOverride });
    } else {
      const [{ createRequire }, { readFileSync }] = await Promise.all([import('node:module'), import('node:fs')]);
      const require = createRequire(import.meta.url);
      const wasmPath = require.resolve('occt-import-js/dist/occt-import-js.wasm');
      const wasmBinary = readFileSync(wasmPath);
      occtPromise = occtimportjsFactory({ wasmBinary });
    }
  }
  return occtPromise;
}

/**
 * Reads a STEP file buffer into occt-import-js's mesh result, in inches.
 * @param {Uint8Array} stepBuffer
 * @param {Uint8Array|Buffer} [wasmBinary] - pre-fetched WASM bytes, for
 *   callers (the Vercel-deployed server route) where the default
 *   filesystem-based loader can't find its binary - see getOcct() above.
 */
export async function readStepMeshes(stepBuffer, wasmBinary) {
  const occt = await getOcct(wasmBinary);
  const result = occt.ReadStepFile(stepBuffer, { linearUnit: 'inch' });
  if (!result.success || !result.meshes?.length) {
    throw new Error('Could not read solid geometry from this STEP file');
  }
  return result.meshes;
}

function triangleVertex(mesh, triIndex, corner) {
  const vi = mesh.index.array[triIndex * 3 + corner];
  const pos = mesh.attributes.position.array;
  return { x: pos[vi * 3], y: pos[vi * 3 + 1], z: pos[vi * 3 + 2], vi };
}

function meshesBoundingBox(meshes) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const mesh of meshes) {
    const pos = mesh.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

/**
 * Turning: max-radius-per-length-bucket envelope across all vertices of all
 * meshes. The "length" axis is auto-detected as whichever of X/Y/Z has the
 * largest bounding-box span (a real turned part is always much longer than
 * it is wide), radius is measured from the bounding-box center of the other
 * two axes. Returns [{z, x}...] (z = position along the detected length
 * axis, x = radius), ordered by position ascending.
 */
// Max plausible diameter-to-length ratio for the short-axis fallback below
// (a disc-shaped turned part - a hub, pulley, washer, flange) before it's
// almost certainly actually flat sheet stock instead. Real hubs/pulleys/
// washers/flanges are rarely more than a few times wider than they are
// thick (found examples: a set-screw hub at ~2.2:1, a V-belt pulley at
// ~3:1); a genuine routed flat plate is typically well past 10:1, often
// 20-100:1. 8 sits comfortably in the gap, generous to legitimate large
// thin discs without accepting an obviously-flat plate through this path.
const MAX_DISC_DIAMETER_TO_LENGTH_RATIO = 8;

/**
 * Picks which bounding-box axis is the part's true rotational axis, trying
 * the largest-span axis first (the common case: an elongated shaft/bar is
 * always much longer than it is wide) and falling back to the SMALLEST-span
 * axis (a short, wide, disc-shaped turned part - a hub, pulley, washer,
 * flange - where the true axial length is the SHORT dimension, not the
 * long one; its diameter, not its thickness, is what dominates the
 * bounding box). Real bug this fixes: "largest span = length" alone
 * rejected a real V-belt pulley and a real set-screw hub as "not a turned
 * part" - both are completely ordinary lathe parts, just wider than they
 * are long, which the largest-span-only heuristic never considered.
 *
 * Returns the accepted candidate's axis assignment, or null if neither the
 * largest-span nor the smallest-span axis produces a plausible turned-part
 * cross-section (see crossSectionAspect below) - the caller throws in that
 * case, using the largest-span candidate's numbers for the error message
 * (the "primary"/expected hypothesis for a typical shaft-like part).
 */
export function pickLengthAxis(spans) {
  const axes = ['x', 'y', 'z'];
  const bySpan = [...axes].sort((a, b) => spans[b] - spans[a]);
  const candidates = [bySpan[0]]; // largest span
  if (bySpan[2] !== bySpan[0]) candidates.push(bySpan[2]); // smallest span, if distinct (skips a perfect-cube tie)

  let primary = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const lengthAxis = candidates[i];
    const [radiusAxisA, radiusAxisB] = axes.filter((a) => a !== lengthAxis);
    const radiusAxisSpanA = spans[radiusAxisA];
    const radiusAxisSpanB = spans[radiusAxisB];
    // Sanity check: real bar stock (round, hex, or square) is roughly as
    // wide in one off-axis direction as the other - the bounding box
    // cross-section is close to square even when the actual cross-section
    // isn't circular (e.g. hex stock turned down to a round shaft is a
    // completely normal lathe operation). A flat plate is the opposite:
    // one off-axis extent (its thickness) is drastically smaller than the
    // other (its width). Without this check, a flat plate's "radius" -
    // computed as hypot() of both off-axis directions - is dominated by
    // the wide direction and produces a numerically plausible profile for
    // a shape that was never a solid of revolution to begin with. Found
    // via a real "550 Motor Plate" STEP file (flat, with mounting holes)
    // that slipped past the maxRadius<length/2 check below by coincidence
    // and would have silently generated lathe G-code for a part that
    // should never go near a lathe.
    const crossSectionAspect = Math.min(radiusAxisSpanA, radiusAxisSpanB) / Math.max(radiusAxisSpanA, radiusAxisSpanB);
    const candidate = { lengthAxis, radiusAxisA, radiusAxisB, radiusAxisSpanA, radiusAxisSpanB, crossSectionAspect };
    if (i === 0) primary = candidate; // always the largest-span attempt, for the error message below

    if (crossSectionAspect < 0.5) continue;
    if (i === 0) return candidate; // largest-span candidate passed outright - the common, unambiguous case

    // The smallest-span candidate passed the roundness bar too, but that
    // alone can't distinguish a genuine disc from a same-proportioned
    // square/rectangular PLATE (a circle and a square share the exact same
    // bounding box) - the diameter-to-length ratio is what actually
    // separates "ordinary hub/pulley/washer" from "obviously flat sheet
    // stock that happens to be square-ish," so gate the fallback on it.
    const approxMaxRadius = Math.hypot(radiusAxisSpanA / 2, radiusAxisSpanB / 2);
    const length = spans[lengthAxis];
    if (approxMaxRadius * 2 / length <= MAX_DISC_DIAMETER_TO_LENGTH_RATIO) return candidate;
  }
  return null; // neither candidate worked - let the caller report the primary (largest-span) attempt's numbers
}

export function extractTurningProfileFromMeshes(meshes, { buckets = 300 } = {}) {
  const bbox = meshesBoundingBox(meshes);
  const spans = {
    x: bbox.maxX - bbox.minX,
    y: bbox.maxY - bbox.minY,
    z: bbox.maxZ - bbox.minZ
  };

  const lengthMinByAxis = { x: bbox.minX, y: bbox.minY, z: bbox.minZ };
  const lengthMaxByAxis = { x: bbox.maxX, y: bbox.maxY, z: bbox.maxZ };
  const primaryLengthAxis = Object.keys(spans).reduce((a, b) => (spans[b] > spans[a] ? b : a));
  if (!Number.isFinite(lengthMinByAxis[primaryLengthAxis]) || !Number.isFinite(lengthMaxByAxis[primaryLengthAxis]) || lengthMaxByAxis[primaryLengthAxis] <= lengthMinByAxis[primaryLengthAxis]) {
    throw new Error('STEP geometry has no usable extent for a turning profile');
  }

  const picked = pickLengthAxis(spans);
  if (!picked) {
    const [radiusAxisA, radiusAxisB] = ['x', 'y', 'z'].filter((a) => a !== primaryLengthAxis);
    throw new Error(
      `This doesn't look like a turned part: cross-section is ${radiusAxisA.toUpperCase()}=${spans[radiusAxisA].toFixed(3)}" by ${radiusAxisB.toUpperCase()}=${spans[radiusAxisB].toFixed(3)}" ` +
      `at its widest - too flat/rectangular for bar stock (turning needs a roughly round/hex/square cross-section, not a plate). This looks like a routed/milled flat part instead.`
    );
  }
  const { lengthAxis, radiusAxisA, radiusAxisB } = picked;
  const lengthMin = lengthMinByAxis[lengthAxis];
  const lengthMax = lengthMaxByAxis[lengthAxis];
  const centerA = (lengthMinByAxis[radiusAxisA] + lengthMaxByAxis[radiusAxisA]) / 2;
  const centerB = (lengthMinByAxis[radiusAxisB] + lengthMaxByAxis[radiusAxisB]) / 2;

  const li = AXIS_INDEX[lengthAxis], ai = AXIS_INDEX[radiusAxisA], bi = AXIS_INDEX[radiusAxisB];
  const bucketSize = (lengthMax - lengthMin) / buckets;
  const maxRadiusByBucket = new Array(buckets + 1).fill(-1);

  function sample(lengthPos, radius) {
    const bucket = Math.min(buckets, Math.max(0, Math.round((lengthPos - lengthMin) / bucketSize)));
    if (radius > maxRadiusByBucket[bucket]) maxRadiusByBucket[bucket] = radius;
  }

  for (const mesh of meshes) {
    const pos = mesh.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      sample(pos[i + li], Math.hypot(pos[i + ai] - centerA, pos[i + bi] - centerB));
    }

    // Also walk every triangle edge and interpolate extra samples along it
    // at roughly bucket resolution, not just its two endpoints. A straight
    // cylindrical run of real bar stock can be tessellated with very few
    // vertices (a flat surface doesn't need many to represent accurately),
    // while a small local feature - e.g. a cross-drilled retention-pin hole
    // - injects a dense vertex cluster right at its own axial position,
    // including vertices on the hole's own near-zero-radius surface. Without
    // this, a fine length-bucket landing in the gap between two sparse OD
    // vertices could end up containing ONLY that hole's inner-surface
    // vertices and nothing from the actual OD, reporting a false near-zero
    // "max radius" there. Found against a real "Vortex Shaft" STEP file: the
    // profile showed the shaft necking down to a literal 0.0000" radius
    // mid-shaft, sandwiched between ~0.27"-radius readings on both sides -
    // which would have cut a phantom groove into solid material. Most of the
    // OD surface at any given length position is still intact even where a
    // narrow cross-hole interrupts part of the circumference, so sampling
    // along OD edges recovers the true envelope; the hole's own low-radius
    // samples simply lose the per-bucket max to the real OD samples now
    // present in the same bucket.
    const idx = mesh.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e += 1) {
        const v1 = idx[t + e] * 3;
        const v2 = idx[t + ((e + 1) % 3)] * 3;
        const l1 = pos[v1 + li], l2 = pos[v2 + li];
        const span = Math.abs(l2 - l1);
        if (span <= bucketSize) continue; // endpoints alone already cover this edge's bucket(s)
        const steps = Math.min(1000, Math.ceil(span / bucketSize));
        const a1 = pos[v1 + ai], b1 = pos[v1 + bi];
        const a2 = pos[v2 + ai], b2 = pos[v2 + bi];
        for (let s = 1; s < steps; s += 1) {
          const frac = s / steps;
          const lengthPos = l1 + frac * (l2 - l1);
          const radius = Math.hypot(a1 + frac * (a2 - a1) - centerA, b1 + frac * (b2 - b1) - centerB);
          sample(lengthPos, radius);
        }
      }
    }
  }

  const profile = [];
  for (let b = 0; b <= buckets; b += 1) {
    if (maxRadiusByBucket[b] < 0) continue; // no geometry sampled at this position
    profile.push({ z: lengthMin + b * bucketSize, x: maxRadiusByBucket[b] });
  }
  if (profile.length < 2) {
    throw new Error('Not enough geometry variation along the detected length axis to build a turning profile - is this really a lathe part?');
  }

  // Sanity check: for the PRIMARY (largest-span-as-length) path only, a real
  // turned part's max radius should be meaningfully smaller than half its
  // length (it's an elongated shaft, not a disc) - if not, the "long axis"
  // heuristic likely picked the wrong axis for this geometry. Does NOT apply
  // to the short-axis fallback path (see pickLengthAxis) - that path exists
  // specifically for disc-shaped turned parts (a hub, pulley, washer,
  // flange) where maxRadius comfortably exceeding half the (short) length
  // is the expected, correct shape, not a red flag; pickLengthAxis already
  // has its own appropriate diameter-to-length guard for that path.
  //
  // Threshold is length/2, not length: since `length` is defined as the
  // single largest bounding-box axis span and `maxRadius` is computed from
  // the other two (necessarily smaller-or-equal) axes via hypot of their
  // half-spans, maxRadius is mathematically bounded at length/sqrt(2) =~
  // 0.707*length whenever the axis choice is even plausible - `maxRadius >
  // length` can never actually be true, which made an earlier version of
  // this check unreachable dead code despite its own comment already
  // describing a length/2 threshold. Found via a synthetic test that could
  // not be made to fail no matter what geometry it was given.
  const maxRadius = Math.max(...profile.map((p) => p.x));
  const length = lengthMax - lengthMin;
  if (lengthAxis === primaryLengthAxis && maxRadius > length / 2) {
    throw new Error(
      `This doesn't look like a turned part: detected length ${length.toFixed(3)}" along the "${lengthAxis}" axis ` +
      `but max radius ${maxRadius.toFixed(3)}" - too wide relative to its length for a shaft. Check the STEP file is a single lathe part, not an assembly or a non-axisymmetric shape.`
    );
  }

  return profile;
}

function faceTriangleRange(mesh, brepFace) {
  // brep_faces gives inclusive triangle index ranges into mesh.index.array.
  const tris = [];
  for (let t = brepFace.first; t <= brepFace.last; t += 1) {
    tris.push([triangleVertex(mesh, t, 0), triangleVertex(mesh, t, 1), triangleVertex(mesh, t, 2)]);
  }
  return tris;
}

function triangleNormalAndArea(a, b, c) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return { normal: len > 0 ? { x: nx / len, y: ny / len, z: nz / len } : { x: 0, y: 0, z: 0 }, area: len / 2 };
}

// Finds the largest-area face (in ANY orientation) whose triangles are all
// genuinely coplanar (same normal, within tolerance) - the flat top/bottom
// of an extruded sheet part, whichever way the part happens to be modeled.
function findLargestPlanarFace(mesh) {
  let best = null;
  for (const brepFace of mesh.brep_faces || []) {
    const tris = faceTriangleRange(mesh, brepFace);
    if (tris.length === 0) continue;
    let area = 0;
    let refNormal = null;
    let planar = true;
    for (const [a, b, c] of tris) {
      const { normal, area: triArea } = triangleNormalAndArea(a, b, c);
      if (normal.x === 0 && normal.y === 0 && normal.z === 0) continue; // degenerate triangle
      if (!refNormal) {
        refNormal = normal;
      } else {
        const dot = normal.x * refNormal.x + normal.y * refNormal.y + normal.z * refNormal.z;
        if (dot < 0.999) { planar = false; break; }
      }
      area += triArea;
    }
    if (!planar || !refNormal) continue;
    if (!best || area > best.area) best = { brepFace, area, tris, normal: refNormal, point: tris[0][0] };
  }
  return best;
}

function edgeKey(vi1, vi2) {
  return vi1 < vi2 ? `${vi1}_${vi2}` : `${vi2}_${vi1}`;
}

// Builds an orthonormal 2D basis (u, v) lying in the plane perpendicular to `normal`.
function planeBasis(normal) {
  const ref = Math.abs(normal.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const ux0 = ref.y * normal.z - ref.z * normal.y;
  const uy0 = ref.z * normal.x - ref.x * normal.z;
  const uz0 = ref.x * normal.y - ref.y * normal.x;
  const uLen = Math.hypot(ux0, uy0, uz0) || 1;
  const u = { x: ux0 / uLen, y: uy0 / uLen, z: uz0 / uLen };
  const v = {
    x: normal.y * u.z - normal.z * u.y,
    y: normal.z * u.x - normal.x * u.z,
    z: normal.x * u.y - normal.y * u.x
  };
  return { u, v };
}

function project(point, origin, u, v) {
  const dx = point.x - origin.x, dy = point.y - origin.y, dz = point.z - origin.z;
  return { x: dx * u.x + dy * u.y + dz * u.z, y: dx * v.x + dy * v.y + dz * v.z };
}

// Traces the boundary of a set of triangles into closed loops of 2D points
// (via the supplied projector), by finding edges used by exactly one
// triangle (the outer/inner silhouette of a planar triangulated region) and
// chaining them. Assumes a well-formed planar region: every boundary vertex
// touches exactly two boundary edges (true for an outline + separate,
// non-touching holes).
function traceBoundaryLoops(tris, projectPoint) {
  const edgeCount = new Map();
  const edgeVertPair = new Map(); // key -> [viA, viB]
  const pointByIndex = new Map(); // vi -> {x, y}

  for (const tri of tris) {
    for (let i = 0; i < 3; i += 1) {
      const a = tri[i], b = tri[(i + 1) % 3];
      pointByIndex.set(a.vi, projectPoint(a));
      pointByIndex.set(b.vi, projectPoint(b));
      const key = edgeKey(a.vi, b.vi);
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      if (!edgeVertPair.has(key)) edgeVertPair.set(key, [a.vi, b.vi]);
    }
  }

  const adjacency = new Map(); // vi -> [neighborVi, ...] (boundary-only)
  for (const [key, count] of edgeCount.entries()) {
    if (count !== 1) continue;
    const [aVi, bVi] = edgeVertPair.get(key);
    if (!adjacency.has(aVi)) adjacency.set(aVi, []);
    if (!adjacency.has(bVi)) adjacency.set(bVi, []);
    adjacency.get(aVi).push(bVi);
    adjacency.get(bVi).push(aVi);
  }

  const visited = new Set();
  const loops = [];
  for (const startVi of adjacency.keys()) {
    if (visited.has(startVi)) continue;
    const loopIndices = [startVi];
    visited.add(startVi);
    let prevVi = null;
    let curVi = startVi;
    while (true) {
      const neighbors = adjacency.get(curVi) || [];
      const nextVi = neighbors.find((n) => n !== prevVi);
      if (nextVi === undefined || nextVi === startVi) break;
      loopIndices.push(nextVi);
      visited.add(nextVi);
      prevVi = curVi;
      curVi = nextVi;
    }
    if (loopIndices.length >= 3) {
      loops.push(loopIndices.map((vi) => pointByIndex.get(vi)));
    }
  }
  return loops;
}

function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Routing: finds the largest flat face (in any orientation), traces its
 * boundary into outer + hole loops projected into that face's own plane,
 * and reads thickness as the part's full extent along the face's normal.
 * Returns { contours: [{points, isHole}], thickness }.
 */
export function extractRoutingContoursFromMeshes(meshes) {
  let best = null;
  for (const mesh of meshes) {
    const candidate = findLargestPlanarFace(mesh);
    if (candidate && (!best || candidate.area > best.area)) best = { ...candidate, mesh };
  }
  if (!best) {
    throw new Error('No flat face found on this part - is this really a flat routed/laser-cut profile?');
  }

  const { u, v } = planeBasis(best.normal);
  const origin = best.point;
  const loops = traceBoundaryLoops(best.tris, (pt) => project(pt, origin, u, v));
  if (loops.length === 0) {
    throw new Error('Could not trace a boundary outline from this STEP file\'s flat face');
  }

  const withArea = loops.map((points) => ({ points, area: signedArea(points) }));
  withArea.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const contours = withArea.map((c, i) => ({ points: c.points, isHole: i > 0 }));

  // Sanity check: does the traced outer contour actually represent the
  // part's full silhouette, or does real geometry extend beyond it that
  // this flat-face trace can't see? A 2.5D router profile can only capture
  // material reachable from ONE flat face straight through the part's
  // thickness - it has no way to represent a stepped/relieved edge or a
  // curved surface (like gear/sprocket teeth) that isn't part of that same
  // flat plane. Without this check, such geometry just silently vanishes:
  // found against a real 32-tooth sprocket STEP file where the chosen flat
  // face stopped at the tooth ROOT relief (radius 1.125" from its own
  // centroid) while the actual tooth TIPS - non-planar surfaces entirely
  // outside that face - reached out to 1.345", almost 20% further. The
  // traced contour became a plain circular disc with zero indication a
  // third of the profile (the teeth) had been dropped.
  //
  // Measured as the ratio of the farthest any mesh vertex projects (in the
  // same face-relative plane, from the outer contour's own centroid) versus
  // the outer contour's own farthest point. Ordinary edge treatments
  // (fillets, chamfers, a bent bracket's angled flange) read at ~1.0-1.06
  // against every real fixture on hand; the sprocket's dropped teeth read
  // at 1.196 - the 1.1 threshold sits with real margin on both sides.
  const outerPoints = contours[0].points;
  let outerCx = 0, outerCy = 0;
  for (const p of outerPoints) { outerCx += p.x; outerCy += p.y; }
  outerCx /= outerPoints.length; outerCy /= outerPoints.length;
  const outerMaxR = Math.max(...outerPoints.map((p) => Math.hypot(p.x - outerCx, p.y - outerCy)));

  let meshMaxR = 0;
  for (const mesh of meshes) {
    const pos = mesh.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const proj = project({ x: pos[i], y: pos[i + 1], z: pos[i + 2] }, origin, u, v);
      const r = Math.hypot(proj.x - outerCx, proj.y - outerCy);
      if (r > meshMaxR) meshMaxR = r;
    }
  }
  if (meshMaxR > outerMaxR * 1.1) {
    throw new Error(
      `This part has geometry beyond the flat face used to trace its outline (real geometry reaches ${meshMaxR.toFixed(3)}" ` +
      `from center vs ${outerMaxR.toFixed(3)}" for the traced face) - likely a stepped/relieved edge or curved features ` +
      `(e.g. gear/sprocket teeth) that a flat 2.5D routing profile can't represent. Check this is a simple flat part.`
    );
  }

  // Thickness = the part's full extent along the flat face's normal - i.e.
  // the perpendicular distance from this face to the opposite (parallel)
  // face, regardless of which world axis that direction happens to be.
  //
  // Measured only on best.mesh (the body the chosen face actually belongs
  // to), not every mesh in the file - a STEP export can legitimately bundle
  // more than one body (a bracket plus its mounting screws, in a real
  // REV-21-2046 file that surfaced this: 3 meshes, 2 of them small fastener
  // bodies). Scanning all meshes let unrelated hardware silently inflate or
  // shrink the measured thickness whenever it extended further along the
  // face normal than the actual part being routed.
  let minD = Infinity, maxD = -Infinity;
  const pos = best.mesh.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) {
    const dx = pos[i] - origin.x, dy = pos[i + 1] - origin.y, dz = pos[i + 2] - origin.z;
    const d = dx * best.normal.x + dy * best.normal.y + dz * best.normal.z;
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  const thickness = Number.isFinite(minD) && Number.isFinite(maxD) ? maxD - minD : null;

  // Sanity check: minD/maxD is only real material thickness if the far
  // extreme is the depth of a genuine, roughly-parallel "bottom" face - not
  // just the farthest point some unrelated, non-parallel wall happens to
  // reach. Real bug found against mounting-bracket-bent.step (REV-41-1623,
  // an already-bent/formed sheet metal bracket, not a flat pattern): its
  // base flange's real bottom face sits at ~20% of the measured range (true
  // thickness ~0.118", matching its flat sibling mounting-bracket-flat.step
  // almost exactly) - but a bent-up wall (normal roughly PERPENDICULAR to
  // best.normal, not parallel) reaches further, to 100% of the range,
  // pulling the far extreme out to 0.591" with no real face backing it -
  // would have told the router to cut ~5x deeper than the actual material.
  //
  // Checked by looking for a second large B-rep face whose normal is
  // roughly ANTI-PARALLEL to best.normal (a genuine opposite/parallel face,
  // not a perpendicular wall) sitting near either extreme - best.mesh's own
  // winning face sits at depth 0 by construction (origin = best.point, a
  // point ON that face), so whichever of minD/maxD isn't ~0 is the "far"
  // side, and which one that is depends on which way best.normal happens to
  // point; checking both bands is simplest and safe, since the winning face
  // itself (alignment +1) can never satisfy the anti-parallel test. A plain
  // "is there area at an intermediate depth" check isn't enough here - it
  // falsely flagged every multi-hole plate on hand (flat-plate.step,
  // multibody-bracket.step, etc.): even a genuinely flat part's own outer
  // perimeter and hole walls are thin strips spanning the *entire* 0..
  // thickness range by construction, averaging to the middle depth same as
  // a real bent wall would - that signal can't tell them apart. Checking
  // face *orientation* at the extremes can: a real bottom face is
  // anti-parallel to the top; a bent wall's face is perpendicular to it.
  if (thickness !== null && thickness > 0) {
    const band = thickness * 0.15;
    let hasParallelFarFace = false;
    for (const brepFace of best.mesh.brep_faces || []) {
      const tris = faceTriangleRange(best.mesh, brepFace);
      if (tris.length === 0) continue;
      let faceArea = 0;
      let refNormal = null;
      let planar = true;
      let depthSum = 0;
      for (const [a, b, c] of tris) {
        const { normal, area: triArea } = triangleNormalAndArea(a, b, c);
        if (normal.x === 0 && normal.y === 0 && normal.z === 0) continue;
        if (!refNormal) refNormal = normal;
        else if (normal.x * refNormal.x + normal.y * refNormal.y + normal.z * refNormal.z < 0.999) planar = false;
        faceArea += triArea;
        for (const p of [a, b, c]) {
          depthSum += (p.x - origin.x) * best.normal.x + (p.y - origin.y) * best.normal.y + (p.z - origin.z) * best.normal.z;
        }
      }
      if (!planar || !refNormal || faceArea < best.area * 0.2) continue;
      const avgDepth = depthSum / (tris.length * 3);
      const alignment = refNormal.x * best.normal.x + refNormal.y * best.normal.y + refNormal.z * best.normal.z;
      const nearMin = avgDepth <= minD + band;
      const nearMax = avgDepth >= maxD - band;
      if ((nearMin || nearMax) && alignment < -0.9) { hasParallelFarFace = true; break; }
    }
    if (!hasParallelFarFace) {
      throw new Error(
        `This part has no face parallel to its flat face at the far end of the measured thickness ` +
        `(${thickness.toFixed(3)}") - likely a bent flange or wall being measured as material thickness, not a ` +
        `genuine opposite face. Check this is a flat pattern, not an already-formed/bent part.`
      );
    }
  }

  return { contours, thickness };
}
