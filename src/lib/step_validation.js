// STEP (ISO 10303-21) file validation.
//
// Catches the common "looks like a .step but is useless on the machine" cases:
// empty/truncated files, files renamed to .step that aren't STEP at all, and
// STEP files that contain no solid geometry. This is a structural/text check —
// it does not run a full CAD kernel, but it reliably rejects the failure modes
// that actually reach the router (empty, truncated, no geometry).

// Entities that indicate the file carries real solid/surface geometry.
const GEOMETRY_ENTITIES = [
  'MANIFOLD_SOLID_BREP',
  'BREP_WITH_VOIDS',
  'FACETED_BREP',
  'CLOSED_SHELL',
  'ADVANCED_BREP_SHAPE_REPRESENTATION',
  'MANIFOLD_SURFACE_SHAPE_REPRESENTATION',
  'SHELL_BASED_SURFACE_MODEL',
  'GEOMETRICALLY_BOUNDED_SURFACE_SHAPE_REPRESENTATION'
];

// A real part has lots of points. An "empty" STEP (header only) has none.
const MIN_CARTESIAN_POINTS = 4;
const MIN_BYTES = 200;

/**
 * Validate raw STEP file text.
 * @param {string} text
 * @returns {{ valid: boolean, reason: string }}
 */
export function validateStepText(text) {
  if (!text || text.trim().length < MIN_BYTES) {
    return { valid: false, reason: 'File is empty or too small to be a real STEP model.' };
  }

  const upper = text.toUpperCase();

  // Must declare itself as a STEP file (ISO 10303-21) near the top.
  if (!upper.slice(0, 2000).includes('ISO-10303-21')) {
    return { valid: false, reason: 'Not a STEP file — missing the ISO-10303-21 header.' };
  }

  // Must have a DATA section.
  if (!/\bDATA\s*;/.test(upper)) {
    return { valid: false, reason: 'STEP file has no DATA section (corrupt or incomplete).' };
  }

  // Must end with the proper footer — otherwise it was truncated mid-write.
  if (!upper.includes('END-ISO-10303-21')) {
    return { valid: false, reason: 'STEP file is truncated — missing the END-ISO-10303-21 footer.' };
  }

  // Must contain at least one solid/surface geometry entity.
  const hasGeometry = GEOMETRY_ENTITIES.some((e) => upper.includes(e));
  if (!hasGeometry) {
    return { valid: false, reason: 'STEP file contains no solid geometry — re-export the part from CAD.' };
  }

  // Sanity check: a real solid has many points.
  const pointMatches = upper.match(/CARTESIAN_POINT/g);
  if (!pointMatches || pointMatches.length < MIN_CARTESIAN_POINTS) {
    return { valid: false, reason: 'STEP file has almost no geometry data — likely an empty or broken export.' };
  }

  return { valid: true, reason: '' };
}

/**
 * Read a File/Blob and validate it as a STEP model.
 * @param {File|Blob} file
 * @returns {Promise<{ valid: boolean, reason: string }>}
 */
export async function validateStepFile(file) {
  if (!file) return { valid: false, reason: 'No file provided.' };
  try {
    const text = await file.text();
    return validateStepText(text);
  } catch (e) {
    return { valid: false, reason: 'Could not read the file: ' + (e?.message || e) };
  }
}
