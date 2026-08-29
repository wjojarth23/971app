import { describe, expect, it } from 'vitest';
import { applyHomography, calibrationPointFromClick, solveHomography } from './homography.js';

const IMAGE_CORNERS = [[100, 80], [1180, 90], [1200, 640], [80, 660]];

function roundTrip(matrix, source) {
  return applyHomography(matrix, source).map((value) => Number(value.toFixed(6)));
}

describe('solveHomography', () => {
  it('recovers an identity transform when source and destination match', () => {
    const matrix = solveHomography(IMAGE_CORNERS, IMAGE_CORNERS);
    for (const corner of IMAGE_CORNERS) {
      expect(roundTrip(matrix, corner)).toEqual(corner);
    }
  });

  it('maps each clicked corner onto the field coordinate given for it', () => {
    // A realistic case: four field landmarks seen in perspective, mapped to
    // their real positions on a 650x320 inch field rectangle.
    const field = [[0, 0], [650, 0], [650, 320], [0, 320]];
    const matrix = solveHomography(IMAGE_CORNERS, field);
    IMAGE_CORNERS.forEach((corner, index) => {
      const mapped = applyHomography(matrix, corner);
      expect(mapped[0]).toBeCloseTo(field[index][0], 6);
      expect(mapped[1]).toBeCloseTo(field[index][1], 6);
    });
  });

  it('recovers a known pure translation and scale', () => {
    const source = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const destination = [[5, 5], [25, 5], [25, 25], [5, 25]]; // scale 2, offset 5
    const matrix = solveHomography(source, destination);
    expect(roundTrip(matrix, [5, 5])).toEqual([15, 15]);
    expect(roundTrip(matrix, [0, 10])).toEqual([5, 25]);
  });

  it('interpolates a point inside the quad, not just the four corners', () => {
    const field = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const matrix = solveHomography(square, field);
    const centre = applyHomography(matrix, [5, 5]);
    expect(centre[0]).toBeCloseTo(50, 6);
    expect(centre[1]).toBeCloseTo(50, 6);
  });

  it('produces a matrix normalized so h33 is 1, matching what the runner expects', () => {
    const matrix = solveHomography(IMAGE_CORNERS, [[0, 0], [650, 0], [650, 320], [0, 320]]);
    expect(matrix).toHaveLength(3);
    expect(matrix[0]).toHaveLength(3);
    expect(matrix[2][2]).toBe(1);
    expect(matrix.flat().every(Number.isFinite)).toBe(true);
  });

  it('refuses degenerate point sets instead of returning a garbage matrix', () => {
    const collinear = [[0, 0], [10, 10], [20, 20], [30, 30]];
    expect(solveHomography(collinear, [[0, 0], [1, 0], [2, 0], [3, 0]])).toBeNull();
    const coincident = [[0, 0], [0, 0], [10, 0], [0, 10]];
    expect(solveHomography(coincident, [[0, 0], [1, 1], [2, 0], [0, 2]])).toBeNull();
  });

  it('refuses malformed input rather than throwing at the caller', () => {
    expect(solveHomography(null, null)).toBeNull();
    expect(solveHomography(IMAGE_CORNERS.slice(0, 3), IMAGE_CORNERS.slice(0, 3))).toBeNull();
    expect(solveHomography(IMAGE_CORNERS, [[0, 0], [1, 0], [1, 1], ['x', 'y']])).toBeNull();
  });
});

describe('calibrationPointFromClick', () => {
  // A 1920x1080 recording displayed at 640x360 in the panel: the whole point
  // is that a click must not be recorded in displayed pixels.
  const rect = { left: 40, top: 100, width: 640, height: 360 };

  it('normalizes a click to 0-1 within the displayed box', () => {
    const point = calibrationPointFromClick({ clientX: 40 + 160, clientY: 100 + 90 }, rect, 1920, 1080);
    expect(point.normalized[0]).toBeCloseTo(0.25, 10);
    expect(point.normalized[1]).toBeCloseTo(0.25, 10);
  });

  it('scales the same click up to the source video resolution', () => {
    const point = calibrationPointFromClick({ clientX: 40 + 160, clientY: 100 + 90 }, rect, 1920, 1080);
    expect(point.pixels[0]).toBeCloseTo(480, 10);
    expect(point.pixels[1]).toBeCloseTo(270, 10);
  });

  it('falls back to displayed size before video metadata has loaded', () => {
    const point = calibrationPointFromClick({ clientX: 40 + 320, clientY: 100 + 180 }, rect, 0, 0);
    expect(point.pixels).toEqual([320, 180]);
  });

  it('clamps a click dragged outside the box instead of recording a negative point', () => {
    const before = calibrationPointFromClick({ clientX: 0, clientY: 0 }, rect, 1920, 1080);
    expect(before.normalized).toEqual([0, 0]);
    const after = calibrationPointFromClick({ clientX: 9999, clientY: 9999 }, rect, 1920, 1080);
    expect(after.normalized).toEqual([1, 1]);
    expect(after.pixels).toEqual([1920, 1080]);
  });

  it('returns null for a box with no size rather than dividing by zero', () => {
    expect(calibrationPointFromClick({ clientX: 1, clientY: 1 }, { left: 0, top: 0, width: 0, height: 0 }, 1920, 1080)).toBeNull();
    expect(calibrationPointFromClick({ clientX: 1, clientY: 1 }, null, 1920, 1080)).toBeNull();
  });

  it('round-trips a clicked point through a homography to the field coordinate it marks', () => {
    // The full chain the calibrator performs: click four corners in the
    // displayed box, record source points in video pixels, solve against
    // known field coordinates, and confirm the matrix maps them back.
    const corners = [[0, 0], [640, 0], [640, 360], [0, 360]];
    const field = [[0, 0], [650, 0], [650, 320], [0, 320]];
    const clicked = corners.map(([x, y]) =>
      calibrationPointFromClick({ clientX: rect.left + x, clientY: rect.top + y }, rect, 1920, 1080).pixels);
    const matrix = solveHomography(clicked, field);
    clicked.forEach((point, index) => {
      const mapped = applyHomography(matrix, point);
      expect(mapped[0]).toBeCloseTo(field[index][0], 6);
      expect(mapped[1]).toBeCloseTo(field[index][1], 6);
    });
  });
});

describe('applyHomography', () => {
  it('returns null for a point the matrix sends to infinity', () => {
    const degenerateDenominator = [[1, 0, 0], [0, 1, 0], [1, 0, 0]];
    expect(applyHomography(degenerateDenominator, [0, 5])).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(applyHomography(null, [1, 2])).toBeNull();
    expect(applyHomography([[1, 0, 0], [0, 1, 0], [0, 0, 1]], ['a', 'b'])).toBeNull();
  });
});
