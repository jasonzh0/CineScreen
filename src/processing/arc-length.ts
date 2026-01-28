/**
 * Arc-Length Parameterization for Smooth 2D Motion
 *
 * This module provides arc-length reparameterization for Bezier curves and
 * linear paths. When X and Y components have different travel distances,
 * standard parameterization causes non-uniform perceived velocity. Arc-length
 * parameterization ensures uniform speed along the path regardless of the
 * direction of movement.
 *
 * Key concepts:
 * - Standard Bezier: B(t) where t ∈ [0,1] controls progress along the curve
 * - Arc-length: s ∈ [0, L] represents actual distance traveled along the curve
 * - Reparameterization: Given s, find t such that arc_length(0,t) = s
 */

import type { EasingType } from '../types/metadata';
import { easeIn, easeOut, easeInOut } from './effects';

/**
 * 2D point interface
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * Default number of samples for arc-length table
 * Higher = more accurate but more memory/computation
 */
const DEFAULT_ARC_LENGTH_SAMPLES = 100;

/**
 * Tolerance for arc-length lookup convergence
 */
const ARC_LENGTH_TOLERANCE = 0.0001;

/**
 * Evaluate a cubic Bezier curve at parameter t
 * B(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
 */
function evaluateCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

/**
 * Evaluate the derivative of a cubic Bezier curve at parameter t
 * B'(t) = 3(1-t)²(P₁-P₀) + 6(1-t)t(P₂-P₁) + 3t²(P₃-P₂)
 */
function evaluateCubicBezierDerivative(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  return {
    x: 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x),
    y: 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y),
  };
}

/**
 * Calculate the magnitude (length) of a 2D vector
 */
function magnitude(p: Point2D): number {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

/**
 * Calculate Euclidean distance between two points
 */
function distance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Arc-length lookup table entry
 */
interface ArcLengthEntry {
  t: number;           // Bezier parameter
  arcLength: number;   // Cumulative arc length from t=0 to this t
}

/**
 * Build an arc-length lookup table for a cubic Bezier curve
 * Uses numerical integration (trapezoidal rule with many samples)
 */
function buildArcLengthTable(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  samples: number = DEFAULT_ARC_LENGTH_SAMPLES
): ArcLengthEntry[] {
  const table: ArcLengthEntry[] = [];
  let cumulativeLength = 0;
  let prevPoint = p0;

  table.push({ t: 0, arcLength: 0 });

  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const currentPoint = evaluateCubicBezier(p0, p1, p2, p3, t);

    // Approximate arc length using chord length (good enough for many samples)
    cumulativeLength += distance(prevPoint, currentPoint);

    table.push({ t, arcLength: cumulativeLength });
    prevPoint = currentPoint;
  }

  return table;
}

/**
 * Find the parameter t for a given arc length using binary search
 * Returns the t value such that the arc length from 0 to t equals targetLength
 */
function getParameterAtArcLength(
  table: ArcLengthEntry[],
  targetLength: number
): number {
  const totalLength = table[table.length - 1].arcLength;

  // Handle edge cases
  if (targetLength <= 0) return 0;
  if (targetLength >= totalLength) return 1;

  // Binary search for the interval containing targetLength
  let low = 0;
  let high = table.length - 1;

  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if (table[mid].arcLength < targetLength) {
      low = mid;
    } else {
      high = mid;
    }
  }

  // Linear interpolation within the interval
  const entry1 = table[low];
  const entry2 = table[high];
  const segmentLength = entry2.arcLength - entry1.arcLength;

  if (segmentLength < ARC_LENGTH_TOLERANCE) {
    return entry1.t;
  }

  const ratio = (targetLength - entry1.arcLength) / segmentLength;
  return entry1.t + ratio * (entry2.t - entry1.t);
}

/**
 * Get the total arc length of a cubic Bezier curve
 */
function getTotalArcLength(table: ArcLengthEntry[]): number {
  return table[table.length - 1].arcLength;
}

/**
 * Cubic Bezier curve with arc-length parameterization
 * Provides uniform-speed traversal along the curve
 */
class ArcLengthBezier {
  private p0: Point2D;
  private p1: Point2D;
  private p2: Point2D;
  private p3: Point2D;
  private arcLengthTable: ArcLengthEntry[];
  private totalLength: number;

  constructor(
    p0: Point2D,
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
    samples: number = DEFAULT_ARC_LENGTH_SAMPLES
  ) {
    this.p0 = p0;
    this.p1 = p1;
    this.p2 = p2;
    this.p3 = p3;
    this.arcLengthTable = buildArcLengthTable(p0, p1, p2, p3, samples);
    this.totalLength = getTotalArcLength(this.arcLengthTable);
  }

  /**
   * Get point at normalized arc-length parameter u ∈ [0, 1]
   * u represents the fraction of total arc length traveled
   */
  getPointAtNormalizedLength(u: number): Point2D {
    const clampedU = Math.max(0, Math.min(1, u));
    const targetLength = clampedU * this.totalLength;
    const t = getParameterAtArcLength(this.arcLengthTable, targetLength);
    return evaluateCubicBezier(this.p0, this.p1, this.p2, this.p3, t);
  }

  /**
   * Get point at absolute arc-length s
   */
  getPointAtArcLength(s: number): Point2D {
    const t = getParameterAtArcLength(this.arcLengthTable, s);
    return evaluateCubicBezier(this.p0, this.p1, this.p2, this.p3, t);
  }

  /**
   * Get the total arc length of the curve
   */
  getTotalLength(): number {
    return this.totalLength;
  }

  /**
   * Get the parameter t for a given normalized arc-length u
   */
  getParameterAtNormalizedLength(u: number): number {
    const clampedU = Math.max(0, Math.min(1, u));
    const targetLength = clampedU * this.totalLength;
    return getParameterAtArcLength(this.arcLengthTable, targetLength);
  }
}

/**
 * Apply easing function to a value
 */
function applyEasingFunction(t: number, easing: EasingType): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'easeIn':
      return easeIn(t);
    case 'easeOut':
      return easeOut(t);
    case 'easeInOut':
    default:
      return easeInOut(t);
  }
}

/**
 * Interpolate linearly between two points with arc-length parameterization
 *
 * For a straight line, this is equivalent to standard linear interpolation,
 * but the function exists for API consistency and to enable future extension.
 *
 * The key difference from naive interpolation is that easing is applied
 * to the arc-length parameter, ensuring uniform perceived speed regardless
 * of the X/Y distance ratio.
 *
 * @param start - Starting point
 * @param end - Ending point
 * @param progress - Progress from 0 to 1 (will be eased)
 * @param easing - Easing function to apply
 * @returns Interpolated point
 */
function interpolateLinearArcLength(
  start: Point2D,
  end: Point2D,
  progress: number,
  easing: EasingType = 'linear'
): Point2D {
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Apply easing to the progress (which represents arc-length fraction for a line)
  const easedProgress = applyEasingFunction(clampedProgress, easing);

  // For a straight line, arc-length parameterization is equivalent to linear lerp
  // because arc-length grows linearly with the parameter for a line
  return {
    x: start.x + (end.x - start.x) * easedProgress,
    y: start.y + (end.y - start.y) * easedProgress,
  };
}

/**
 * Create a smooth Bezier curve between two points with automatic control points
 *
 * This creates a "smooth" curve where the control points are placed to create
 * a natural-looking motion, avoiding the "diagonal then straight" effect of
 * naive linear interpolation with different X/Y distances.
 *
 * @param start - Starting point
 * @param end - Ending point
 * @param tension - Controls how curved the path is (0 = straight line, 1 = maximum curve)
 * @returns Control points [p0, p1, p2, p3] for a cubic Bezier
 */
function createSmoothBezier(
  start: Point2D,
  end: Point2D,
  tension: number = 0.5
): [Point2D, Point2D, Point2D, Point2D] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // Control points are offset perpendicular to the direction
  // and along the direction to create a smooth curve
  const handleLength = Math.sqrt(dx * dx + dy * dy) * tension / 3;

  // For smooth motion, place control points along the line
  // This creates a curve that starts and ends tangent to the endpoints
  const p1: Point2D = {
    x: start.x + dx * tension,
    y: start.y + dy * tension,
  };

  const p2: Point2D = {
    x: end.x - dx * tension,
    y: end.y - dy * tension,
  };

  return [start, p1, p2, end];
}

/**
 * Interpolate along a cubic Bezier curve with arc-length parameterization
 *
 * This ensures uniform speed along the curve regardless of the curve's shape.
 * The easing is applied to the arc-length parameter, not to the Bezier t parameter.
 *
 * @param p0 - Start point (control point 0)
 * @param p1 - Control point 1
 * @param p2 - Control point 2
 * @param p3 - End point (control point 3)
 * @param progress - Progress from 0 to 1 (will be eased)
 * @param easing - Easing function to apply
 * @param arcLengthTable - Pre-computed arc-length table (optional, will be computed if not provided)
 * @returns Interpolated point
 */
function interpolateBezierArcLength(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  progress: number,
  easing: EasingType = 'linear',
  arcLengthTable?: ArcLengthEntry[]
): Point2D {
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Apply easing to the arc-length progress
  const easedProgress = applyEasingFunction(clampedProgress, easing);

  // Get or build the arc-length table
  const table = arcLengthTable || buildArcLengthTable(p0, p1, p2, p3);
  const totalLength = getTotalArcLength(table);

  // Find the parameter t that corresponds to the desired arc-length
  const targetLength = easedProgress * totalLength;
  const t = getParameterAtArcLength(table, targetLength);

  // Evaluate the Bezier at the found parameter
  return evaluateCubicBezier(p0, p1, p2, p3, t);
}

/**
 * High-level function for smooth 2D interpolation between two points
 *
 * This is the main function to use for cursor/zoom position interpolation.
 * It handles the arc-length parameterization internally and applies easing
 * to the arc-length, ensuring uniform perceived speed.
 *
 * For simple point-to-point motion, use mode: 'linear'.
 * For smoother curved motion, use mode: 'bezier'.
 *
 * @param start - Starting point
 * @param end - Ending point
 * @param progress - Progress from 0 to 1 (raw, before easing)
 * @param easing - Easing function to apply
 * @param mode - 'linear' for straight line, 'bezier' for smooth curve
 * @param bezierTension - Curve tension for bezier mode (0-1)
 * @returns Interpolated point with uniform perceived speed
 */
export function interpolate2DArcLength(
  start: Point2D,
  end: Point2D,
  progress: number,
  easing: EasingType = 'linear',
  mode: 'linear' | 'bezier' = 'linear',
  bezierTension: number = 0.5
): Point2D {
  if (mode === 'linear') {
    return interpolateLinearArcLength(start, end, progress, easing);
  }

  // Create smooth Bezier control points
  const [p0, p1, p2, p3] = createSmoothBezier(start, end, bezierTension);

  return interpolateBezierArcLength(p0, p1, p2, p3, progress, easing);
}

/**
 * Catmull-Rom spline interpolation with arc-length parameterization
 *
 * Given 4 points, creates a smooth curve that passes through p1 and p2.
 * This is useful for cursor motion where we have multiple keyframes
 * and want smooth transitions through each point.
 *
 * @param p0 - Previous point (for tangent calculation)
 * @param p1 - Start point of current segment
 * @param p2 - End point of current segment
 * @param p3 - Next point (for tangent calculation)
 * @param progress - Progress from 0 to 1 within p1-p2 segment
 * @param easing - Easing function to apply
 * @param tension - Catmull-Rom tension (0.5 = standard, 0 = sharp, 1 = loose)
 * @returns Interpolated point
 */
export function interpolateCatmullRomArcLength(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  progress: number,
  easing: EasingType = 'linear',
  tension: number = 0.5
): Point2D {
  // Convert Catmull-Rom to cubic Bezier control points
  // The Catmull-Rom spline passes through p1 and p2
  const t = tension;

  const cp1: Point2D = {
    x: p1.x + (p2.x - p0.x) * t / 3,
    y: p1.y + (p2.y - p0.y) * t / 3,
  };

  const cp2: Point2D = {
    x: p2.x - (p3.x - p1.x) * t / 3,
    y: p2.y - (p3.y - p1.y) * t / 3,
  };

  return interpolateBezierArcLength(p1, cp1, cp2, p2, progress, easing);
}

/**
 * Multi-point path interpolation with arc-length parameterization
 *
 * Given an array of points, creates a smooth path through all points
 * with uniform speed along the entire path.
 *
 * @param points - Array of points defining the path
 * @param progress - Progress from 0 to 1 along the entire path
 * @param easing - Easing function to apply to overall progress
 * @returns Interpolated point
 */
function interpolatePathArcLength(
  points: Point2D[],
  progress: number,
  easing: EasingType = 'linear'
): Point2D {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  if (points.length === 1) {
    return { ...points[0] };
  }

  if (points.length === 2) {
    return interpolateLinearArcLength(points[0], points[1], progress, easing);
  }

  // Apply easing to the overall progress
  const easedProgress = applyEasingFunction(Math.max(0, Math.min(1, progress)), easing);

  // Calculate segment lengths
  const segmentLengths: number[] = [];
  let totalLength = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const len = distance(points[i], points[i + 1]);
    segmentLengths.push(len);
    totalLength += len;
  }

  if (totalLength === 0) {
    return { ...points[0] };
  }

  // Find which segment we're in based on arc-length
  const targetLength = easedProgress * totalLength;
  let accumulatedLength = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const segmentLength = segmentLengths[i];

    if (accumulatedLength + segmentLength >= targetLength || i === segmentLengths.length - 1) {
      // We're in this segment
      const segmentProgress = segmentLength > 0
        ? (targetLength - accumulatedLength) / segmentLength
        : 0;

      // Use Catmull-Rom if we have neighboring points
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      // Don't apply easing again - we already applied it to the overall progress
      return interpolateCatmullRomArcLength(p0, p1, p2, p3, segmentProgress, 'linear');
    }

    accumulatedLength += segmentLength;
  }

  // Fallback to last point
  return { ...points[points.length - 1] };
}

/**
 * Interpolate a 2D position along with a scalar value (like zoom level)
 * Both position and scalar are interpolated with consistent timing
 *
 * @param startPos - Starting position
 * @param endPos - Ending position
 * @param startValue - Starting scalar value
 * @param endValue - Ending scalar value
 * @param progress - Progress from 0 to 1
 * @param easing - Easing function to apply
 * @returns Object with interpolated x, y, and value
 */
export function interpolatePositionAndValue(
  startPos: Point2D,
  endPos: Point2D,
  startValue: number,
  endValue: number,
  progress: number,
  easing: EasingType = 'linear'
): { x: number; y: number; value: number } {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const easedProgress = applyEasingFunction(clampedProgress, easing);

  // Position with arc-length (for a line, this is equivalent but semantically correct)
  const pos = interpolateLinearArcLength(startPos, endPos, progress, easing);

  // Value interpolation uses the same eased progress
  const value = startValue + (endValue - startValue) * easedProgress;

  return {
    x: pos.x,
    y: pos.y,
    value,
  };
}
