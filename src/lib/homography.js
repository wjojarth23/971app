// Solving a 3x3 homography from four point correspondences, so per-venue
// calibration is "click four field landmarks and type their real coordinates"
// instead of computing a matrix by hand. The result feeds
// vision_views.homography, which vision_runner.py's field_point() applies to
// put every robot track and game-piece trajectory into field coordinates.

// Gaussian elimination with partial pivoting. Small fixed system (8x8), so
// there's no reason to reach for a linear-algebra dependency.
function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    // A zero pivot means the points are degenerate - three of them collinear,
    // or two coincident. There is no unique homography through such a set.
    if (Math.abs(augmented[pivotRow][column]) < 1e-12) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column] / augmented[column][column];
      if (!factor) continue;
      for (let col = column; col <= size; col += 1) augmented[row][col] -= factor * augmented[column][col];
    }
  }

  return augmented.map((row, index) => row[size] / row[index]);
}

function isFinitePair(point) {
  return Array.isArray(point) && point.length >= 2
    && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
}

/**
 * Build the homography mapping four source points onto four destination
 * points. Source points are pixel coordinates picked off a video frame;
 * destination points are the real field coordinates of those same landmarks
 * (any consistent unit - inches, metres - the runner just carries it through).
 *
 * Returns a 3x3 array normalized so h33 is 1, or null when the points are
 * degenerate (collinear or coincident), which is the common way a hand-picked
 * set goes wrong.
 */
export function solveHomography(sourcePoints, destinationPoints) {
  if (!Array.isArray(sourcePoints) || !Array.isArray(destinationPoints)) return null;
  if (sourcePoints.length !== 4 || destinationPoints.length !== 4) return null;
  if (!sourcePoints.every(isFinitePair) || !destinationPoints.every(isFinitePair)) return null;

  // Direct Linear Transform: each correspondence contributes two rows,
  // expressing that (x', y') is the perspective-divided image of (x, y).
  const rows = [];
  const targets = [];
  for (let index = 0; index < 4; index += 1) {
    const x = Number(sourcePoints[index][0]);
    const y = Number(sourcePoints[index][1]);
    const u = Number(destinationPoints[index][0]);
    const v = Number(destinationPoints[index][1]);
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    targets.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    targets.push(v);
  }

  const solution = solveLinearSystem(rows, targets);
  if (!solution || solution.some((value) => !Number.isFinite(value))) return null;

  return [
    [solution[0], solution[1], solution[2]],
    [solution[3], solution[4], solution[5]],
    [solution[6], solution[7], 1]
  ];
}

/**
 * Convert a click inside a displayed video box into the two coordinate spaces
 * calibration needs: `normalized` 0-1 for mask/goal-zone polygons, and
 * `pixels` in the source video's own resolution for homography source points.
 *
 * The distinction matters because the player is almost always scaled down to
 * fit the panel, so displayed pixels are not video pixels. Clicks are clamped
 * to the box, since a drag can report a position just outside it.
 */
export function calibrationPointFromClick({ clientX, clientY }, rect, videoWidth, videoHeight) {
  if (!rect?.width || !rect?.height) return null;
  const fractionX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const fractionY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  return {
    normalized: [fractionX, fractionY],
    pixels: [fractionX * (videoWidth || rect.width), fractionY * (videoHeight || rect.height)]
  };
}

/** Apply a homography to a point, matching cv2.perspectiveTransform. */
export function applyHomography(matrix, point) {
  if (!matrix || !isFinitePair(point)) return null;
  const x = Number(point[0]);
  const y = Number(point[1]);
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  if (!denominator) return null;
  return [
    (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
    (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator
  ];
}
