import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStepMeshes, extractTurningProfileFromMeshes, extractRoutingContoursFromMeshes, pickLengthAxis } from './stepProfile.js';
import { generateTurningGcode } from './turning.js';
import { generateRoutingGcode } from './routing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEX_SHAFT = path.join(__dirname, '__fixtures__', 'hex-shaft.step');
const FLAT_PLATE = path.join(__dirname, '__fixtures__', 'flat-plate.step');
// Real, more complex CAD files pulled from REV Robotics' public STEP library
// to stress-test the pipeline past simple shapes - each of these caught a
// real bug on first pass (see the describe blocks below).
const VORTEX_SHAFT = path.join(__dirname, '__fixtures__', 'vortex-shaft.step'); // REV-21-2807
const HEX_ADAPTER = path.join(__dirname, '__fixtures__', 'hex-adapter.step'); // REV-41-1620
const MAXSPLINE_BRACKET = path.join(__dirname, '__fixtures__', 'maxspline-bracket.step'); // REV-21-2360
const MULTIBODY_BRACKET = path.join(__dirname, '__fixtures__', 'multibody-bracket.step'); // REV-21-2046
const MOUNTING_BRACKET_FLAT = path.join(__dirname, '__fixtures__', 'mounting-bracket-flat.step'); // REV-41-1624
const MOUNTING_BRACKET_BENT = path.join(__dirname, '__fixtures__', 'mounting-bracket-bent.step'); // REV-41-1623
// From AndyMark's public STEP library - a further round of stress-testing
// against real, more complex parts.
const SPROCKET_32T = path.join(__dirname, '__fixtures__', 'sprocket-32t.step'); // am-4781
const LEAD_SCREW = path.join(__dirname, '__fixtures__', 'lead-screw.step'); // am-3257
const TOUGHBOX_MOTOR_PLATE = path.join(__dirname, '__fixtures__', 'toughbox-motor-plate.step'); // am-0978
// From step.parts (github.com/earthtojake/step.parts, MIT licensed) - real,
// short/wide (diameter > length) turned parts that caught a real bug: the
// turning-profile length-axis auto-detection only ever tried the bounding
// box's LARGEST span as the rotational axis, which is wrong for a
// disc-shaped part (a hub, pulley, washer, flange) where the true axial
// length is the SHORTEST span - see pickLengthAxis in stepProfile.js.
const SET_SCREW_HUB = path.join(__dirname, '__fixtures__', 'set-screw-hub.step');
const V_BELT_PULLEY = path.join(__dirname, '__fixtures__', 'v-belt-pulley.step');

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

describe('extractTurningProfileFromMeshes (real STEP file: vortex-shaft.step - a stepped motor shaft with a cross-drilled retention-pin hole)', () => {
  let meshes;
  beforeAll(async () => {
    meshes = await readStepMeshes(fs.readFileSync(VORTEX_SHAFT));
  });

  it('produces a profile with no near-zero-radius dropouts mid-shaft (the real file behind the synthetic regression test above)', () => {
    const profile = extractTurningProfileFromMeshes(meshes);
    const maxRadius = Math.max(...profile.map((p) => p.x));
    // Any interior point (not the very first/last, which taper to the
    // part's actual ends) dropping below ~40% of the max radius would be
    // the bug reappearing - the pin hole's own near-zero-radius vertices
    // winning a bucket's "max radius" over the real OD.
    for (let i = 2; i < profile.length - 2; i += 1) {
      expect(profile[i].x).toBeGreaterThan(maxRadius * 0.4);
    }
  });

  it('generates G-code end to end', () => {
    const profile = extractTurningProfileFromMeshes(meshes);
    const maxRadius = Math.max(...profile.map((p) => p.x));
    const result = generateTurningGcode(profile, {
      stockDiameter: maxRadius * 2 * 1.05, stepDown: 0.05, finishAllowance: 0.02, feedRough: 0.008, feedFinish: 0.004
    });
    expect(result.gcode).toContain('M30');
    expect(result.stats).toBeDefined();
  });
});

describe('extractTurningProfileFromMeshes (real STEP file: hex-adapter.step - a stepped round-to-hex adapter with a bore)', () => {
  it('generates G-code end to end', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(HEX_ADAPTER));
    const profile = extractTurningProfileFromMeshes(meshes);
    const maxRadius = Math.max(...profile.map((p) => p.x));
    const result = generateTurningGcode(profile, {
      stockDiameter: maxRadius * 2 * 1.05, stepDown: 0.05, finishAllowance: 0.02, feedRough: 0.008, feedFinish: 0.004
    });
    expect(result.gcode).toContain('M30');
  });
});

describe('extractTurningProfileFromMeshes (real STEP file: lead-screw.step - a long, thin, stepped shaft)', () => {
  it('produces a clean profile with no near-zero-radius dropouts and generates G-code end to end', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(LEAD_SCREW));
    const profile = extractTurningProfileFromMeshes(meshes);
    const maxRadius = Math.max(...profile.map((p) => p.x));
    for (let i = 2; i < profile.length - 2; i += 1) {
      expect(profile[i].x).toBeGreaterThan(maxRadius * 0.4);
    }
    const result = generateTurningGcode(profile, {
      stockDiameter: maxRadius * 2 * 1.05, stepDown: 0.05, finishAllowance: 0.02, feedRough: 0.008, feedFinish: 0.004
    });
    expect(result.gcode).toContain('M30');
  });
});

describe('extractTurningProfileFromMeshes (real STEP file: set-screw-hub.step - a real bug: short/wide disc-shaped part, diameter > length)', () => {
  it('correctly picks the short axis as rotational, not the largest-span diameter axis, and generates G-code end to end', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(SET_SCREW_HUB));
    const profile = extractTurningProfileFromMeshes(meshes);
    const maxRadius = Math.max(...profile.map((p) => p.x));
    const length = Math.abs(profile[profile.length - 1].z - profile[0].z);
    // This part is genuinely wider than it is long (a real hub, not a
    // shaft) - the pre-fix version rejected this outright as "not a turned
    // part" because it always tried the largest bounding-box span (a
    // diameter direction) as the rotational axis first and never fell back.
    expect(maxRadius).toBeGreaterThan(length / 2);
    const result = generateTurningGcode(profile, {
      stockDiameter: maxRadius * 2 * 1.1, stepDown: 0.05, finishAllowance: 0.02, feedRough: 0.008, feedFinish: 0.004
    });
    expect(result.gcode).toContain('M30');
  });
});

describe('extractTurningProfileFromMeshes (real STEP file: v-belt-pulley.step - another short/wide disc-shaped part)', () => {
  it('correctly picks the short axis as rotational and generates G-code end to end', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(V_BELT_PULLEY));
    const profile = extractTurningProfileFromMeshes(meshes);
    const maxRadius = Math.max(...profile.map((p) => p.x));
    const length = Math.abs(profile[profile.length - 1].z - profile[0].z);
    expect(maxRadius).toBeGreaterThan(length / 2);
    const result = generateTurningGcode(profile, {
      stockDiameter: maxRadius * 2 * 1.1, stepDown: 0.05, finishAllowance: 0.02, feedRough: 0.008, feedFinish: 0.004
    });
    expect(result.gcode).toContain('M30');
  });
});

describe('extractRoutingContoursFromMeshes (real STEP file: sprocket-32t.step - a 32-tooth chain sprocket, the file behind the silhouette-overrun check below)', () => {
  it('rejects the part instead of silently tracing a toothless disc (real bug: the largest flat face stops at the tooth ROOT relief; the actual tooth TIPS are non-planar surfaces entirely outside that face and reach ~20% further out - the traced contour used to become a plain circular disc with zero indication the teeth had been dropped)', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(SPROCKET_32T));
    expect(() => extractRoutingContoursFromMeshes(meshes)).toThrow(/geometry beyond the flat face/);
  });
});

describe('extractRoutingContoursFromMeshes (real STEP file: toughbox-motor-plate.step - a classic multi-hole gearbox motor plate)', () => {
  it('generates G-code end to end with a multi-tool sequence sized for its smallest holes', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(TOUGHBOX_MOTOR_PLATE));
    const { contours, thickness } = extractRoutingContoursFromMeshes(meshes);
    expect(contours.length).toBeGreaterThan(5);
    // 0.0625" added after routing.js started rejecting a helical entry that
    // doesn't leave real clearance (see MIN_HELIX_RADIUS_FRACTION) - this
    // part's smallest holes are only marginally bigger than 0.125", which
    // used to "fit" (didn't collapse the offset) but left almost no
    // toolpath radius, producing a 100+ turn near-stationary "helix."
    const toolSequence = [0.375, 0.25, 0.125, 0.0625].map((d, i) => ({ toolDiameter: d, toolNumber: i + 1 }));
    const result = generateRoutingGcode(contours, { stepDown: 0.1, targetDepth: thickness, toolSequence });
    expect(result.gcode).toContain('M30');
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

describe('extractRoutingContoursFromMeshes (real STEP file: multibody-bracket.step - the real file behind the multi-mesh thickness test above: a bracket bundled with 2 small fastener bodies)', () => {
  it('reads a sane thickness for the bracket itself, not contaminated by the fastener bodies', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(MULTIBODY_BRACKET));
    expect(meshes.length).toBeGreaterThan(1); // confirms this really is a multi-body file
    const { thickness } = extractRoutingContoursFromMeshes(meshes);
    expect(thickness).toBeCloseTo(0.25, 1);
  });

  it('generates G-code end to end with a multi-tool sequence sized for its smallest holes', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(MULTIBODY_BRACKET));
    const { contours, thickness } = extractRoutingContoursFromMeshes(meshes);
    const toolSequence = [0.1875, 0.125, 0.0625].map((d, i) => ({ toolDiameter: d, toolNumber: i + 1 }));
    const result = generateRoutingGcode(contours, { stepDown: 0.1, targetDepth: thickness, toolSequence });
    expect(result.gcode).toContain('M30');
  });
});

describe('extractRoutingContoursFromMeshes (real STEP file: maxspline-bracket.step - includes a real 175-point internal spline bore, the file behind the minThroatDistance message fix in routing.test.js)', () => {
  it('generates G-code end to end with a multi-tool sequence sized for the spline bore', async () => {
    const meshes = await readStepMeshes(fs.readFileSync(MAXSPLINE_BRACKET));
    const { contours, thickness } = extractRoutingContoursFromMeshes(meshes);
    const toolSequence = [0.1875, 0.125, 0.0625].map((d, i) => ({ toolDiameter: d, toolNumber: i + 1 }));
    const result = generateRoutingGcode(contours, { stepDown: 0.1, targetDepth: thickness, toolSequence });
    expect(result.gcode).toContain('M30');
  });
});

describe('extractRoutingContoursFromMeshes (real STEP files: mounting-bracket-flat.step / mounting-bracket-bent.step - genuinely complex multi-hole brackets)', () => {
  it.each([
    ['mounting-bracket-flat.step', MOUNTING_BRACKET_FLAT],
    ['mounting-bracket-bent.step', MOUNTING_BRACKET_BENT]
  ])('%s generates G-code end to end with a multi-tool sequence', async (_name, filePath) => {
    const meshes = await readStepMeshes(fs.readFileSync(filePath));
    const { contours, thickness } = extractRoutingContoursFromMeshes(meshes);
    expect(contours.length).toBeGreaterThan(5); // genuinely multi-feature, not a plain plate
    const toolSequence = [0.1875, 0.125, 0.0625].map((d, i) => ({ toolDiameter: d, toolNumber: i + 1 }));
    const result = generateRoutingGcode(contours, { stepDown: 0.1, targetDepth: thickness, toolSequence });
    expect(result.gcode).toContain('M30');
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

describe('pickLengthAxis (synthetic bounding-box spans - the length-axis auto-detection heuristic itself)', () => {
  it('picks the largest span as length for an elongated shaft (the common case, unchanged from before)', () => {
    const picked = pickLengthAxis({ x: 4, y: 0.5, z: 0.5 });
    expect(picked.lengthAxis).toBe('x');
  });

  it('falls back to the SMALLEST span as length for a short/wide disc-shaped part (a hub, pulley, washer) - real bug: the largest-span-only heuristic rejected these outright', () => {
    const picked = pickLengthAxis({ x: 0.7, y: 0.7, z: 0.3 });
    expect(picked.lengthAxis).toBe('z');
  });

  it('still rejects a genuine flat SQUARE plate even though its bounding box is indistinguishable from a round disc by aspect ratio alone - gated by the diameter-to-length ratio, not just roundness', () => {
    // 4"x4"x0.1" square plate: same off-axis aspect ratio (1.0, perfectly
    // "round"-looking by bounding box alone) as a genuine 4"-diameter,
    // 0.1"-thick disc would have - only the diameter:length ratio (40:1
    // here, versus a real disc's typical single-digit ratio) tells them apart.
    const picked = pickLengthAxis({ x: 4, y: 4, z: 0.1 });
    expect(picked).toBeNull();
  });

  it('still rejects a genuine rectangular (non-square) flat plate', () => {
    const picked = pickLengthAxis({ x: 4, y: 2, z: 0.1 });
    expect(picked).toBeNull();
  });

  it('accepts a reasonably proportioned disc (diameter well within the sanity ratio)', () => {
    const picked = pickLengthAxis({ x: 1, y: 1, z: 0.3 }); // ~3.3:1 diameter:length
    expect(picked.lengthAxis).toBe('z');
  });

  it('rejects an unreasonably thin "disc" past the diameter-to-length sanity ratio (still plate-like, just happened to pass the roundness check)', () => {
    const picked = pickLengthAxis({ x: 5, y: 0.1, z: 3 }); // passes roundness on the y-as-length fallback, but the diameter:length ratio is still plate-like
    expect(picked).toBeNull();
  });

  it('tolerates a hex/square bar-stock cross-section on the primary (elongated) path - real turned parts are not always circular', () => {
    const picked = pickLengthAxis({ x: 3, y: 0.5, z: 0.4 }); // 0.8 aspect - within the 0.5 roundness bar
    expect(picked.lengthAxis).toBe('x');
  });

  it('handles a perfect-cube bounding box without erroring (degenerate tie between largest and smallest span)', () => {
    const picked = pickLengthAxis({ x: 1, y: 1, z: 1 });
    expect(picked).not.toBeNull();
    expect(['x', 'y', 'z']).toContain(picked.lengthAxis);
  });
});
