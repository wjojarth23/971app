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
export function extractTurningProfileFromMeshes(meshes, { buckets = 300 } = {}) {
  const bbox = meshesBoundingBox(meshes);
  const spans = {
    x: bbox.maxX - bbox.minX,
    y: bbox.maxY - bbox.minY,
    z: bbox.maxZ - bbox.minZ
  };
  const lengthAxis = Object.keys(spans).reduce((a, b) => (spans[b] > spans[a] ? b : a));
  const [radiusAxisA, radiusAxisB] = ['x', 'y', 'z'].filter((a) => a !== lengthAxis);
  const lengthMin = { x: bbox.minX, y: bbox.minY, z: bbox.minZ }[lengthAxis];
  const lengthMax = { x: bbox.maxX, y: bbox.maxY, z: bbox.maxZ }[lengthAxis];
  const centerA = ({ x: bbox.minX, y: bbox.minY, z: bbox.minZ }[radiusAxisA] + { x: bbox.maxX, y: bbox.maxY, z: bbox.maxZ }[radiusAxisA]) / 2;
  const centerB = ({ x: bbox.minX, y: bbox.minY, z: bbox.minZ }[radiusAxisB] + { x: bbox.maxX, y: bbox.maxY, z: bbox.maxZ }[radiusAxisB]) / 2;

  if (!Number.isFinite(lengthMin) || !Number.isFinite(lengthMax) || lengthMax <= lengthMin) {
    throw new Error('STEP geometry has no usable extent for a turning profile');
  }

  const li = AXIS_INDEX[lengthAxis], ai = AXIS_INDEX[radiusAxisA], bi = AXIS_INDEX[radiusAxisB];
  const bucketSize = (lengthMax - lengthMin) / buckets;
  const maxRadiusByBucket = new Array(buckets + 1).fill(-1);

  for (const mesh of meshes) {
    const pos = mesh.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const lengthPos = pos[i + li];
      const radius = Math.hypot(pos[i + ai] - centerA, pos[i + bi] - centerB);
      const bucket = Math.min(buckets, Math.max(0, Math.round((lengthPos - lengthMin) / bucketSize)));
      if (radius > maxRadiusByBucket[bucket]) maxRadiusByBucket[bucket] = radius;
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

  // Sanity check: a real turned part's max radius should be meaningfully
  // smaller than half its length (it's a shaft, not a disc) - if not, the
  // "long axis" heuristic likely picked the wrong axis for this geometry.
  const maxRadius = Math.max(...profile.map((p) => p.x));
  const length = lengthMax - lengthMin;
  if (maxRadius > length) {
    throw new Error(
      `This doesn't look like a turned part: detected length ${length.toFixed(3)}" along the "${lengthAxis}" axis ` +
      `but max radius ${maxRadius.toFixed(3)}" - wider than it is long. Check the STEP file is a single lathe part, not an assembly or a non-axisymmetric shape.`
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
    if (candidate && (!best || candidate.area > best.area)) best = candidate;
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

  // Thickness = the part's full extent along the flat face's normal - i.e.
  // the perpendicular distance from this face to the opposite (parallel)
  // face, regardless of which world axis that direction happens to be.
  let minD = Infinity, maxD = -Infinity;
  for (const mesh of meshes) {
    const pos = mesh.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const dx = pos[i] - origin.x, dy = pos[i + 1] - origin.y, dz = pos[i + 2] - origin.z;
      const d = dx * best.normal.x + dy * best.normal.y + dz * best.normal.z;
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }
  }
  const thickness = Number.isFinite(minD) && Number.isFinite(maxD) ? maxD - minD : null;

  return { contours, thickness };
}
