import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStepMeshes, extractTurningProfileFromMeshes, extractRoutingContoursFromMeshes } from './stepProfile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEX_SHAFT = path.join(__dirname, '__fixtures__', 'hex-shaft.step');
const FLAT_PLATE = path.join(__dirname, '__fixtures__', 'flat-plate.step');

// Real STEP files, committed as fixtures - these previously caught a real
// bug (both extractors silently assumed the STEP file's Z axis was the
// relevant one; these files' actual long/thickness axes are X, not Z - see
// stepProfile.js's top-of-file doc comment). Loading real geometry through
// occt-import-js is slow-ish (WASM init) - loaded once per file, reused
// across tests in the same describe block.

describe('extractTurningProfileFromMeshes (real STEP file: hex-shaft.step)', () => {
  let meshes;
  beforeAll(async () => {
    meshes = await readStepMeshes(fs.readFileSync(HEX_SHAFT));
  });

  it('auto-detects the long axis regardless of which one the STEP file used', () => {
    const profile = extractTurningProfileFromMeshes(meshes);
    const length = Math.abs(profile[profile.length - 1].z - profile[0].z);
    // Known-good values, verified against this exact file - the long axis
    // here is X in the STEP file's own coordinates, not Z.
    expect(length).toBeCloseTo(5.178, 2);
  });

  it('computes a plausible max radius (well under the length - a shaft, not a disc)', () => {
    const profile = extractTurningProfileFromMeshes(meshes);
    const maxRadius = Math.max(...profile.map((p) => p.x));
    expect(maxRadius).toBeCloseTo(0.271, 2);
    const length = Math.abs(profile[profile.length - 1].z - profile[0].z);
    expect(maxRadius).toBeLessThan(length); // the sanity guard in stepProfile.js itself
  });

  it('rejects a profile whose radius exceeds half the detected length (wrong-axis / disc-shaped guard)', () => {
    // length is bounded by definition as the single largest bounding-box
    // span, so radius (from the other two axes) can approach but never
    // exceed length/sqrt(2) =~ 0.707*length - constructed so both "radius"
    // axes (Y, Z) independently span nearly as much as the picked length
    // axis (X, 10) and a single point sits at both their extremes at once,
    // giving radius ~7.0 against a length/2 threshold of 5.
    const discMeshes = [{
      attributes: { position: { array: new Float32Array([0, 4.95, 4.95, 10, 4.95, 4.95, 5, -4.95, -4.95]) } },
      index: { array: new Uint32Array([]) },
      brep_faces: []
    }];
    expect(() => extractTurningProfileFromMeshes(discMeshes)).toThrow(/doesn't look like a turned part/);
  });

  it('does not report a false near-zero radius mid-shaft when a length-bucket only contains an unrelated small feature\'s vertices (real bug: a cross-drilled retention-pin hole on a real "Vortex Shaft" STEP file left some fine length-buckets containing only the hole\'s own near-zero-radius vertices, with no OD vertices sampled in that same narrow slice - the profile reported the shaft necking down to a literal 0.0000" radius, sandwiched between full-diameter readings on both sides, which would have cut a phantom groove into solid material)', () => {
    // A simple round tube from z=0 to z=10, radius 1, tessellated with
    // vertices ONLY at its two end rings (exactly what a real STEP export
    // can do for a long straight cylindrical run - a flat surface doesn't
    // need interior vertices to tessellate accurately). Plus 4 loose
    // vertices at (0,0,5) - unconnected to any OD-spanning edge - standing
    // in for a small feature's own near-zero-radius surface sitting right
    // at the shaft's midpoint, same as the real hole that caught this.
    const positions = [];
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * 2 * Math.PI;
      positions.push(Math.cos(a), Math.sin(a), 0); // ring A: indices 0-7
    }
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * 2 * Math.PI;
      positions.push(Math.cos(a), Math.sin(a), 10); // ring B: indices 8-15
    }
    for (let i = 0; i < 4; i += 1) positions.push(0, 0, 5); // indices 16-19

    const indices = [];
    for (let k = 0; k < 8; k += 1) {
      const a0 = k, a1 = (k + 1) % 8;
      const b0 = 8 + k, b1 = 8 + ((k + 1) % 8);
      indices.push(a0, a1, b0);
      indices.push(a1, b1, b0);
    }

    const mesh = {
      attributes: { position: { array: new Float32Array(positions) } },
      index: { array: new Uint32Array(indices) },
      brep_faces: []
    };

    const profile = extractTurningProfileFromMeshes([mesh], { buckets: 20 });
    const midpoint = profile.find((p) => Math.abs(p.z - 5) < 0.3);
    expect(midpoint).toBeDefined();
    expect(midpoint.x).toBeGreaterThan(0.9); // must read close to the true OD radius (1), not the hole's 0
  });

  it('rejects a flat plate whose cross-section aspect ratio gives it away, even when it passes the maxRadius<length/2 guard', () => {
    // A thin plate: long in X (10), wide in Y (8), thin in Z (0.5) - this is
    // exactly the shape that slipped through before this check existed (a
    // real "550 Motor Plate" STEP file: long, wide, flat, with mounting
    // holes). maxRadius here is hypot(4, 0.25) =~ 4.008, comfortably under
    // length/2 = 5, so only the new aspect-ratio check catches it.
    const plateMeshes = [{
      attributes: {
        position: {
          array: new Float32Array([
            0, -4, -0.25, 0, 4, -0.25, 0, 4, 0.25, 0, -4, 0.25,
            10, -4, -0.25, 10, 4, -0.25, 10, 4, 0.25, 10, -4, 0.25
          ])
        }
      },
      index: { array: new Uint32Array([]) },
      brep_faces: []
    }];
    expect(() => extractTurningProfileFromMeshes(plateMeshes)).toThrow(/too flat\/rectangular for bar stock/);
  });

  it('rejects the real flat-plate.step fixture (a genuinely flat/holed part, not bar stock)', async () => {
    const plateMeshes = await readStepMeshes(fs.readFileSync(FLAT_PLATE));
    expect(() => extractTurningProfileFromMeshes(plateMeshes)).toThrow(/doesn't look like a turned part/);
  });
});

describe('extractRoutingContoursFromMeshes (real STEP file: flat-plate.step)', () => {
  let meshes;
  beforeAll(async () => {
    meshes = await readStepMeshes(fs.readFileSync(FLAT_PLATE));
  });

  it('finds the flat face and traces its outline', () => {
    const { contours } = extractRoutingContoursFromMeshes(meshes);
    expect(contours.length).toBeGreaterThanOrEqual(1);
    expect(contours[0].isHole).toBe(false);
  });

  it('reads material thickness from the face normal direction, not a hardcoded Z bounding box', () => {
    // Known-good value for this file - this specific check caught a real
    // bug where thickness came out ~8x too large (2.074" instead of 0.25")
    // because the old code measured along Z instead of the face's own normal.
    const { thickness } = extractRoutingContoursFromMeshes(meshes);
    expect(thickness).toBeCloseTo(0.25, 1);
  });

  it('ignores unrelated bodies in a multi-mesh STEP file when measuring thickness', () => {
    // A real STEP file (REV-21-2046) came through as 3 separate meshes: the
    // actual bracket plus two small fastener bodies bundled into the same
    // file. Face SELECTION already correctly picks whichever mesh has the
    // largest flat face, but thickness used to be measured by scanning
    // every mesh's raw vertices regardless of which body the chosen face
    // came from - a fastener poking further along the face normal than the
    // part itself would silently inflate the measured thickness. Modeled
    // here as a flat 2x2 plate (real thickness 2) plus a detached "fastener"
    // mesh with a vertex way out at z=50 and no flat face of its own (so it
    // never wins face selection, but the old code still scanned its
    // position array for the thickness min/max).
    const plateMesh = {
      attributes: {
        position: {
          array: new Float32Array([
            -5, -5, 0, 5, -5, 0, 5, 5, 0, -5, 5, 0, // top face (traced)
            -5, -5, -2, 5, -5, -2, 5, 5, -2, -5, 5, -2 // bottom face (thickness only)
          ])
        }
      },
      index: { array: new Uint32Array([0, 1, 2, 0, 2, 3]) },
      brep_faces: [{ first: 0, last: 1 }]
    };
    const fastenerMesh = {
      attributes: { position: { array: new Float32Array([0, 0, 50, 0.1, 0, 50]) } },
      index: { array: new Uint32Array([]) },
      brep_faces: []
    };
    const { thickness } = extractRoutingContoursFromMeshes([plateMesh, fastenerMesh]);
    expect(thickness).toBeCloseTo(2, 5);
  });
});

describe('readStepMeshes', () => {
  it('loads real geometry with vertices, triangle indices, and named faces', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(HEX_SHAFT));
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes[0].attributes.position.array.length).toBeGreaterThan(0);
    expect(meshes[0].index.array.length).toBeGreaterThan(0);
  });

  it('throws a clear error for garbage input instead of a cryptic WASM crash', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(readStepMeshes(garbage)).rejects.toThrow();
  });
});
