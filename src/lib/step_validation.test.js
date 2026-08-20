import { describe, it, expect } from 'vitest';
import { validateStepText, validateStepFile } from './step_validation.js';

function buildValidStepText({ geometryEntity = 'MANIFOLD_SOLID_BREP', points = 10 } = {}) {
  const pointLines = Array.from({ length: points }, (_, i) => `#${i + 2}=CARTESIAN_POINT('',(0.,0.,0.));`).join('\n');
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION((''),'2;1');",
    'ENDSEC;',
    'DATA;',
    `#1=${geometryEntity}('');`,
    pointLines,
    'ENDSEC;',
    'END-ISO-10303-21;'
  ].join('\n');
}

describe('validateStepText', () => {
  it('accepts a well-formed STEP file with real geometry', () => {
    const result = validateStepText(buildValidStepText());
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('');
  });

  it('rejects empty or near-empty input', () => {
    expect(validateStepText('').valid).toBe(false);
    expect(validateStepText('   ').valid).toBe(false);
    expect(validateStepText('short').valid).toBe(false);
  });

  it('rejects a file missing the ISO-10303-21 header', () => {
    // Deliberately avoids the shared builder: its footer also contains the
    // "ISO-10303-21" substring, which would leak into the header check within
    // the first 2000 chars and mask the very thing this test checks for.
    const text = 'NOT-A-STEP-FILE;\n' + 'x'.repeat(250);
    const result = validateStepText(text);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ISO-10303-21/);
  });

  it('rejects a file with no DATA section', () => {
    const text = buildValidStepText().replace('DATA;', 'NOTDATA;');
    const result = validateStepText(text);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/DATA section/);
  });

  it('rejects a truncated file missing the END-ISO-10303-21 footer', () => {
    const text = buildValidStepText().replace('END-ISO-10303-21;', '');
    const result = validateStepText(text);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/truncated/);
  });

  it('rejects a file with no solid/surface geometry entity', () => {
    const text = buildValidStepText({ geometryEntity: 'SOME_UNRELATED_ENTITY' });
    const result = validateStepText(text);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no solid geometry/);
  });

  it('rejects a file with a geometry entity but almost no point data (empty export)', () => {
    // Padded past MIN_BYTES so this exercises the point-count check
    // specifically, not the "too small overall" check.
    const text = buildValidStepText({ points: 1 }) + '\n' + '/* padding */ '.repeat(20);
    const result = validateStepText(text);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/almost no geometry data/);
  });

  it('accepts any of the recognized geometry entity types', () => {
    for (const entity of ['BREP_WITH_VOIDS', 'FACETED_BREP', 'CLOSED_SHELL', 'ADVANCED_BREP_SHAPE_REPRESENTATION']) {
      expect(validateStepText(buildValidStepText({ geometryEntity: entity })).valid).toBe(true);
    }
  });

  it('is case-insensitive for the header/footer/entity checks', () => {
    const text = buildValidStepText().toLowerCase();
    expect(validateStepText(text).valid).toBe(true);
  });
});

describe('validateStepFile', () => {
  it('rejects a null/undefined file', async () => {
    const result = await validateStepFile(null);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/No file/);
  });

  it('reads and validates a real File/Blob-like object', async () => {
    const text = buildValidStepText();
    const fakeFile = { text: async () => text };
    const result = await validateStepFile(fakeFile);
    expect(result.valid).toBe(true);
  });

  it('reports a readable error if the file cannot be read', async () => {
    const brokenFile = { text: async () => { throw new Error('disk error'); } };
    const result = await validateStepFile(brokenFile);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Could not read the file/);
  });
});
