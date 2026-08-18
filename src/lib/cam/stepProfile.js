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
 *   thing a lathe can produce), so instead of detecting an axis and slicing,
 *   this scans every vertex, buckets by Z, and takes the max radius per
 *   bucket - the outer envelope IS the turning profile for a real turned
 *   part. REQUIRED CONVENTION: the part must be modeled with the spindle
 *   axis aligned to the STEP file's Z axis, centered at X=0, Y=0.
 * - Routing: finds the largest near-horizontal planar face (top or bottom of
 *   a flat/sheet part), traces its triangle-boundary edges into closed 2D
 *   loops (outer profile + holes), and reads material thickness straight off
 *   the mesh's Z bounding box. REQUIRED CONVENTION: the part is a flat
 *   profile extruded along the STEP file's Z axis.
 */

let occtPromise = null;
async function getOcct() {
  if (!occtPromise) {
    const occtimportjsFactory = (await import('occt-import-js')).default;
    occtPromise = occtimportjsFactory();
  }
  return occtPromise;
}

/** Reads a STEP file buffer into occt-import-js's mesh result, in inches. */
export async function readStepMeshes(stepBuffer) {
  const occt = await getOcct();
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

/**
 * Turning: max-radius-per-Z-bucket envelope across all vertices of all
 * meshes. Returns [{z, x}...] (x = radius), ordered by Z ascending.
 */
export function extractTurningProfileFromMeshes(meshes, { buckets = 300 } = {}) {
  let minZ = Infinity, maxZ = -Infinity;
  for (const mesh of meshes) {
    const pos = mesh.attributes.position.array;
    for (let i = 2; i < pos.length; i += 3) {
      minZ = Math.min(minZ, pos[i]);
      maxZ = Math.max(maxZ, pos[i]);
    }
  }
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ) || maxZ <= minZ) {
    throw new Error('STEP geometry has no usable Z extent for a turning profile');
  }

  const bucketSize = (maxZ - minZ) / buckets;
  const maxRadiusByBucket = new Array(buckets + 1).fill(-1);

  for (const mesh of meshes) {
    const pos = mesh.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      const radius = Math.hypot(x, y);
      const bucket = Math.min(buckets, Math.max(0, Math.round((z - minZ) / bucketSize)));
      if (radius > maxRadiusByBucket[bucket]) maxRadiusByBucket[bucket] = radius;
    }
  }

  const profile = [];
  for (let b = 0; b <= buckets; b += 1) {
    if (maxRadiusByBucket[b] < 0) continue; // no geometry sampled at this Z
    profile.push({ z: minZ + b * bucketSize, x: maxRadiusByBucket[b] });
  }
  if (profile.length < 2) {
    throw new Error('Not enough geometry variation along Z to build a turning profile - is this really a lathe part?');
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

// Finds the largest face (by total area) whose triangles are all
// near-horizontal (|normal.z| above threshold) - the flat top/bottom of an
// extruded sheet part.
function findLargestHorizontalFace(mesh) {
  let best = null;
  for (const brepFace of mesh.brep_faces || []) {
    let area = 0;
    let horizontal = true;
    const tris = faceTriangleRange(mesh, brepFace);
    if (tris.length === 0) continue;
    for (const [a, b, c] of tris) {
      const { normal, area: triArea } = triangleNormalAndArea(a, b, c);
      if (Math.abs(normal.z) < 0.9) { horizontal = false; break; }
      area += triArea;
    }
    if (!horizontal) continue;
    if (!best || area > best.area) best = { brepFace, area, tris };
  }
  return best;
}

function edgeKey(vi1, vi2) {
  return vi1 < vi2 ? `${vi1}_${vi2}` : `${vi2}_${vi1}`;
}

// Traces the boundary of a set of triangles into closed loops of 2D (x,y)
// points, by finding edges used by exactly one triangle (the outer/inner
// silhouette of a planar triangulated region) and chaining them. Assumes a
// well-formed planar region: every boundary vertex touches exactly two
// boundary edges (true for a simple outline + separate, non-touching holes).
function traceBoundaryLoops(tris) {
  const edgeCount = new Map();
  const edgeVertPair = new Map(); // key -> [viA, viB]
  const pointByIndex = new Map(); // vi -> {x, y}

  for (const tri of tris) {
    for (let i = 0; i < 3; i += 1) {
      const a = tri[i], b = tri[(i + 1) % 3];
      pointByIndex.set(a.vi, { x: a.x, y: a.y });
      pointByIndex.set(b.vi, { x: b.x, y: b.y });
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
 * Routing: finds the flat face, traces its boundary into outer + hole loops,
 * reads thickness from the overall Z bounding box.
 * Returns { contours: [{points, isHole}], thickness }.
 */
export function extractRoutingContoursFromMeshes(meshes) {
  let best = null;
  for (const mesh of meshes) {
    const candidate = findLargestHorizontalFace(mesh);
    if (candidate && (!best || candidate.area > best.area)) best = candidate;
  }
  if (!best) {
    throw new Error('No flat (horizontal) face found - is this really a flat routed/laser-cut part, modeled with its face along the STEP file\'s Z axis?');
  }

  const loops = traceBoundaryLoops(best.tris);
  if (loops.length === 0) {
    throw new Error('Could not trace a boundary outline from this STEP file\'s flat face');
  }

  const withArea = loops.map((points) => ({ points, area: signedArea(points) }));
  withArea.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const contours = withArea.map((c, i) => ({ points: c.points, isHole: i > 0 }));

  let minZ = Infinity, maxZ = -Infinity;
  for (const mesh of meshes) {
    const pos = mesh.attributes.position.array;
    for (let i = 2; i < pos.length; i += 3) {
      minZ = Math.min(minZ, pos[i]);
      maxZ = Math.max(maxZ, pos[i]);
    }
  }
  const thickness = Number.isFinite(minZ) && Number.isFinite(maxZ) ? maxZ - minZ : null;

  return { contours, thickness };
}
