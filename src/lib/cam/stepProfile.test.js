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
