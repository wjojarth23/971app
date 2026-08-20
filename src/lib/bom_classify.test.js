import { describe, it, expect } from 'vitest';
import { partClassificationService } from './bom_classify.js';

function classify(item) {
  return partClassificationService.manualClassification([item])[0];
}

describe('manualClassification (COTS vs manufactured rules)', () => {
  it('classifies a part with a vendor as COTS regardless of everything else', () => {
    const result = classify({ name: 'Custom Bracket', part_number: 'P123', vendor: 'WCP' });
    expect(result.classification).toBe('COTS');
    expect(result.workflow_status).toBe('purchase');
  });

  it('classifies belt/acetal/delrin material as COTS', () => {
    expect(classify({ name: 'Widget', material: 'Timing Belt' }).classification).toBe('COTS');
    expect(classify({ name: 'Widget', material: 'Acetal Rod' }).classification).toBe('COTS');
    expect(classify({ name: 'Widget', material: 'Delrin' }).classification).toBe('COTS');
  });

  it('classifies anything with "wcp" in the name as COTS', () => {
    expect(classify({ name: 'WCP Gearbox' }).classification).toBe('COTS');
  });

  it('marks standard_content items as COTS', () => {
    expect(classify({ name: 'Screw', standard_content: true }).classification).toBe('COTS');
    expect(classify({ name: 'Screw', standard_content: 'true' }).classification).toBe('COTS');
  });

  it('forces COTS when a manufactured candidate has no part number starting with "P"', () => {
    const result = classify({ name: 'Custom Plate', part_number: 'X123' });
    expect(result.classification).toBe('COTS');
    expect(result.manufacturing_process).toBeNull();
  });

  it('assigns 3d-print for nylon/PLA/ABS/PETG/onyx materials on a P-numbered part', () => {
    expect(classify({ name: 'Housing', part_number: 'P1', material: 'Nylon' }).manufacturing_process).toBe('3d-print');
    expect(classify({ name: 'Housing', part_number: 'P1', material: 'PLA' }).manufacturing_process).toBe('3d-print');
    expect(classify({ name: 'Housing', part_number: 'P1', material: 'Onyx' }).manufacturing_process).toBe('3d-print');
  });

  it('assigns lathe for shaft/standoff named parts', () => {
    expect(classify({ name: 'Drive Shaft', part_number: 'P1' }).manufacturing_process).toBe('lathe');
    expect(classify({ name: 'M3 Standoff', part_number: 'P1' }).manufacturing_process).toBe('lathe');
  });

  it('assigns router for birch/polycarbonate material or plate/tube named parts', () => {
    expect(classify({ name: 'Panel', part_number: 'P1', material: 'Birch Plywood' }).manufacturing_process).toBe('router');
    expect(classify({ name: 'Panel', part_number: 'P1', material: 'Polycarbonate' }).manufacturing_process).toBe('router');
    expect(classify({ name: 'Side Plate', part_number: 'P1' }).manufacturing_process).toBe('router');
    expect(classify({ name: 'Support Tube', part_number: 'P1' }).manufacturing_process).toBe('router');
  });

  it('defaults to mill for a P-numbered part matching no other rule', () => {
    expect(classify({ name: 'Mystery Part', part_number: 'P1', material: 'Aluminum' }).manufacturing_process).toBe('mill');
  });

  it('checks rules in priority order: 3d-print material beats a shaft-like name', () => {
    // name says "shaft" (would be lathe) but material says nylon (3d-print wins - checked first)
    expect(classify({ name: 'Idler Shaft', part_number: 'P1', material: 'Nylon' }).manufacturing_process).toBe('3d-print');
  });

  it('sets workflow_status to the manufacturing process for manufactured parts', () => {
    const result = classify({ name: 'Drive Shaft', part_number: 'P1' });
    expect(result.workflow_status).toBe('lathe');
  });

  it('falls back to "Unknown" part_name when no name is given', () => {
    expect(classify({ part_number: 'P1' }).part_name).toBe('Unknown');
  });
});

describe('isSheetGeometry', () => {
  it('treats acrylic and poly materials as sheet goods regardless of dimensions', () => {
    expect(partClassificationService.isSheetGeometry([1, 1, 1], 'acrylic')).toBe(true);
    expect(partClassificationService.isSheetGeometry([1, 1, 1], 'polycarbonate')).toBe(true);
  });

  it('treats wood/birch materials as sheet goods regardless of dimensions', () => {
    expect(partClassificationService.isSheetGeometry([1, 1, 1], 'birch')).toBe(true);
  });

  it('uses the aspect-ratio heuristic for other materials: thin and wide is a sheet', () => {
    expect(partClassificationService.isSheetGeometry([0.1, 5, 5], 'aluminum')).toBe(true);
  });

  it('rejects a thick block even with a high aspect ratio', () => {
    expect(partClassificationService.isSheetGeometry([0.3, 5, 5], 'aluminum')).toBe(false);
  });

  it('rejects a low-aspect-ratio block', () => {
    expect(partClassificationService.isSheetGeometry([1, 1.5, 2], 'aluminum')).toBe(false);
  });
});

describe('isShaftGeometry', () => {
  it('identifies a long, round cross-section part as a shaft', () => {
    expect(partClassificationService.isShaftGeometry([0.5, 0.5, 3])).toBe(true);
  });

  it('rejects a part that is not long enough relative to its cross-section', () => {
    expect(partClassificationService.isShaftGeometry([0.5, 0.5, 0.8])).toBe(false);
  });

  it('rejects a long but flat (non-round) cross-section', () => {
    expect(partClassificationService.isShaftGeometry([0.1, 1, 3])).toBe(false);
  });
});

describe('isCubicGeometry', () => {
  it('identifies a block where every dimension exceeds 0.5"', () => {
    expect(partClassificationService.isCubicGeometry([1, 1, 1])).toBe(true);
  });

  it('rejects a small part under the 0.5" threshold', () => {
    expect(partClassificationService.isCubicGeometry([0.3, 1, 1])).toBe(false);
  });
});
