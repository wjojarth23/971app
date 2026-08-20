import { describe, it, expect } from 'vitest';
import { getFileFormatForWorkflow } from './parts_helpers.js';

describe('getFileFormatForWorkflow', () => {
  it('uses STEP for 3d-print', () => {
    expect(getFileFormatForWorkflow('3d-print')).toBe('step');
  });

  it('uses parasolid for router, laser-cut, mill, and lathe', () => {
    expect(getFileFormatForWorkflow('router')).toBe('parasolid');
    expect(getFileFormatForWorkflow('laser-cut')).toBe('parasolid');
    expect(getFileFormatForWorkflow('mill')).toBe('parasolid');
    expect(getFileFormatForWorkflow('lathe')).toBe('parasolid');
  });

  it('falls back to STEP for an unrecognized workflow', () => {
    expect(getFileFormatForWorkflow('unknown-workflow')).toBe('step');
    expect(getFileFormatForWorkflow(undefined)).toBe('step');
  });
});
