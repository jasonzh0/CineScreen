/**
 * Shared cursor utilities for preview and export rendering
 * Contains common functions to avoid code duplication
 */

import type { CursorKeyframe, EasingType } from '../types/metadata';
import { easeInOut, easeIn, easeOut } from './effects';
import {
  interpolate2DArcLength,
  interpolateCatmullRomArcLength,
  type Point2D,
} from './arc-length';
import {
  CURSOR_CLICK_ANIMATION_DURATION_MS,
  CURSOR_CLICK_ANIMATION_SCALE,
} from '../utils/constants';

/**
 * Cursor smooth time for glide effect
 * Higher values create more prominent glide
 * 0.25 = smooth glide effect with good responsiveness
 */
export const CURSOR_SMOOTH_TIME = 0.25;

/**
 * Look-ahead window (ms) to check if cursor type change is sustained
 * If cursor type flickers back within this window, don't change
 */
export const CURSOR_TYPE_LOOKAHEAD_MS = 100;

/**
 * Get stabilized cursor type by looking ahead in keyframes
 * Returns the current type if the change is just a brief flicker
 */
export function getStabilizedCursorType(
  keyframes: CursorKeyframe[],
  currentIndex: number,
  timestamp: number,
  currentType: string,
  lookaheadMs: number = CURSOR_TYPE_LOOKAHEAD_MS
): string {
  if (keyframes.length === 0) return currentType;

  const keyframe = keyframes[currentIndex];
  if (!keyframe) return currentType;

  const newType = keyframe.shape || 'arrow';

  // If same as current, no change needed
  if (newType === currentType) {
    return currentType;
  }

  // Look ahead to see if this type change is sustained
  const lookaheadEnd = timestamp + lookaheadMs;
  let sustainedType = newType;

  // Check keyframes within the lookahead window
  for (let i = currentIndex + 1; i < keyframes.length; i++) {
    const futureKeyframe = keyframes[i];
    if (futureKeyframe.timestamp > lookaheadEnd) {
      break;
    }

    const futureType = futureKeyframe.shape || 'arrow';

    // If it flickers back to current type, don't change
    if (futureType === currentType) {
      return currentType;
    }

    sustainedType = futureType;
  }

  // Type change is sustained, apply it
  return newType;
}

/**
 * Cursor type stabilizer that uses look-ahead for smoother transitions
 */
export class CursorTypeStabilizer {
  private currentType: string = 'arrow';
  private keyframes: CursorKeyframe[] = [];
  private readonly lookaheadMs: number;

  constructor(initialType: string = 'arrow', lookaheadMs: number = CURSOR_TYPE_LOOKAHEAD_MS) {
    this.currentType = initialType;
    this.lookaheadMs = lookaheadMs;
  }

  /**
   * Set keyframes for look-ahead functionality
   */
  setKeyframes(keyframes: CursorKeyframe[]): void {
    this.keyframes = keyframes;
  }

  /**
   * Update with new cursor type and timestamp
   * Uses look-ahead to determine if change should be applied
   */
  update(newType: string | undefined, timestamp: number): string {
    const type = newType || 'arrow';

    // If same as current, no change needed
    if (type === this.currentType) {
      return this.currentType;
    }

    // Find current keyframe index
    let currentIndex = 0;
    for (let i = 0; i < this.keyframes.length; i++) {
      if (this.keyframes[i].timestamp <= timestamp) {
        currentIndex = i;
      } else {
        break;
      }
    }

    // Use look-ahead to check if change is sustained
    const stabilizedType = getStabilizedCursorType(
      this.keyframes,
      currentIndex,
      timestamp,
      this.currentType,
      this.lookaheadMs
    );

    this.currentType = stabilizedType;
    return this.currentType;
  }

  getCurrentType(): string {
    return this.currentType;
  }
}

/**
 * Cursor hotspot offsets (x, y) within the 32x32 viewBox
 * These represent the click point within the cursor image
 */
export const CURSOR_HOTSPOT_MAP: Record<string, { x: number; y: number }> = {
  // Standard cursors
  arrow: { x: 10, y: 7 },
  pointer: { x: 9, y: 8 },
  hand: { x: 10, y: 10 },
  openhand: { x: 10, y: 10 },
  closedhand: { x: 10, y: 10 },
  crosshair: { x: 16, y: 16 },
  ibeam: { x: 13, y: 8 },
  ibeamvertical: { x: 8, y: 16 },

  // Resize cursors - centered
  move: { x: 16, y: 16 },
  resizeleft: { x: 16, y: 16 },
  resizeright: { x: 16, y: 16 },
  resizeleftright: { x: 16, y: 16 },
  resizeup: { x: 16, y: 16 },
  resizedown: { x: 16, y: 16 },
  resizeupdown: { x: 16, y: 16 },
  resize: { x: 16, y: 16 },
  resizenortheast: { x: 16, y: 16 },
  resizesouthwest: { x: 16, y: 16 },
  resizenorthwest: { x: 16, y: 16 },
  resizesoutheast: { x: 16, y: 16 },

  // Action cursors
  copy: { x: 10, y: 7 },
  dragcopy: { x: 10, y: 7 },
  draglink: { x: 10, y: 7 },
  help: { x: 10, y: 7 },
  notallowed: { x: 16, y: 16 },
  contextmenu: { x: 10, y: 7 },
  poof: { x: 16, y: 16 },

  // Zoom/screenshot cursors
  zoomin: { x: 10, y: 10 },
  zoomout: { x: 10, y: 10 },
  screenshot: { x: 16, y: 16 },
};

/**
 * Get cursor hotspot offset for a given shape
 */
export function getCursorHotspot(shape: string): { x: number; y: number } {
  return CURSOR_HOTSPOT_MAP[shape] || CURSOR_HOTSPOT_MAP.arrow || { x: 10, y: 7 };
}

/**
 * Apply easing function based on type
 */
export function applyEasing(t: number, easing: EasingType): number {
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
 * Interpolate cursor position between keyframes using arc-length parameterization
 *
 * Arc-length parameterization ensures uniform perceived speed along the path
 * regardless of the X/Y distance ratio. This prevents the "diagonal then straight"
 * effect that occurs with naive independent X/Y interpolation.
 *
 * When we have neighboring keyframes (for Catmull-Rom), we use spline interpolation
 * for even smoother curved motion through the keyframes.
 */
export function interpolateCursorPosition(
  keyframes: CursorKeyframe[],
  timestamp: number
): { x: number; y: number; size?: number; shape?: string } | null {
  if (keyframes.length === 0) return null;
  if (keyframes.length === 1) {
    const kf = keyframes[0];
    return { x: kf.x, y: kf.y, size: kf.size, shape: kf.shape };
  }

  // Handle timestamp before first keyframe - return first keyframe position
  if (timestamp < keyframes[0].timestamp) {
    const kf = keyframes[0];
    return { x: kf.x, y: kf.y, size: kf.size, shape: kf.shape };
  }

  // Handle timestamp after last keyframe - return last keyframe position
  if (timestamp >= keyframes[keyframes.length - 1].timestamp) {
    const kf = keyframes[keyframes.length - 1];
    return { x: kf.x, y: kf.y, size: kf.size, shape: kf.shape };
  }

  // Find the index of the keyframe just before or at this timestamp
  let prevIndex = 0;
  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].timestamp <= timestamp) {
      prevIndex = i;
    } else {
      break;
    }
  }

  const prevKeyframe = keyframes[prevIndex];
  const nextKeyframe = keyframes[prevIndex + 1] || keyframes[prevIndex];

  if (!prevKeyframe || !nextKeyframe) {
    return null;
  }

  // If timestamps are the same, return the keyframe value
  if (prevKeyframe.timestamp === nextKeyframe.timestamp) {
    return {
      x: prevKeyframe.x,
      y: prevKeyframe.y,
      size: prevKeyframe.size,
      shape: prevKeyframe.shape,
    };
  }

  // Calculate raw progress (0 to 1)
  const timeDiff = nextKeyframe.timestamp - prevKeyframe.timestamp;
  const rawT = timeDiff > 0 ? (timestamp - prevKeyframe.timestamp) / timeDiff : 0;
  // Clamp t to [0, 1] as a safety measure
  const t = Math.max(0, Math.min(1, rawT));

  // Use easing from start keyframe, or default to linear for smooth motion
  const easingType: EasingType = prevKeyframe.easing || 'linear';

  // Define points for interpolation
  const startPoint: Point2D = { x: prevKeyframe.x, y: prevKeyframe.y };
  const endPoint: Point2D = { x: nextKeyframe.x, y: nextKeyframe.y };

  let interpolatedPos: Point2D;

  // Use Catmull-Rom spline if we have neighboring keyframes for smoother curves
  if (keyframes.length >= 4 && prevIndex > 0 && prevIndex < keyframes.length - 2) {
    // We have enough context for Catmull-Rom spline interpolation
    const p0: Point2D = { x: keyframes[prevIndex - 1].x, y: keyframes[prevIndex - 1].y };
    const p1: Point2D = startPoint;
    const p2: Point2D = endPoint;
    const p3: Point2D = { x: keyframes[prevIndex + 2].x, y: keyframes[prevIndex + 2].y };

    // Use arc-length parameterized Catmull-Rom interpolation
    interpolatedPos = interpolateCatmullRomArcLength(p0, p1, p2, p3, t, easingType);
  } else {
    // Use arc-length parameterized linear interpolation
    // The easing is applied to the arc-length parameter, ensuring uniform speed
    interpolatedPos = interpolate2DArcLength(startPoint, endPoint, t, easingType, 'linear');
  }

  // Interpolate size with the same timing (using standard eased t for scalar)
  const easedT = applyEasing(t, easingType);
  const size =
    prevKeyframe.size !== undefined && nextKeyframe.size !== undefined
      ? prevKeyframe.size + (nextKeyframe.size - prevKeyframe.size) * easedT
      : prevKeyframe.size || nextKeyframe.size;

  return {
    x: interpolatedPos.x,
    y: interpolatedPos.y,
    size,
    shape: prevKeyframe.shape || nextKeyframe.shape,
  };
}

/**
 * Calculate cursor click animation scale based on time since click
 * Returns 1.0 (no scale) if no click is active, or scale value (0-1) during animation
 */
export function calculateClickAnimationScale(
  timestamp: number,
  clicks: Array<{ timestamp: number; action: string }>
): number {
  // Find the most recent click "down" event within animation duration
  const clickDownEvents = clicks.filter((c) => c.action === 'down');
  let mostRecentClick: { timestamp: number } | null = null;

  for (const click of clickDownEvents) {
    const timeSinceClick = timestamp - click.timestamp;
    if (timeSinceClick >= 0 && timeSinceClick <= CURSOR_CLICK_ANIMATION_DURATION_MS) {
      if (!mostRecentClick || click.timestamp > mostRecentClick.timestamp) {
        mostRecentClick = click;
      }
    }
  }

  if (!mostRecentClick) {
    return 1.0; // No active click animation
  }

  const timeSinceClick = timestamp - mostRecentClick.timestamp;
  const progress = timeSinceClick / CURSOR_CLICK_ANIMATION_DURATION_MS;

  // Scale down quickly, then scale back up
  // Use easeOut for scale down (first half), easeIn for scale up (second half)
  if (progress < 0.5) {
    // Scale down phase (0 to 0.5)
    const t = progress * 2; // 0 to 1
    const easedT = easeOut(t);
    return 1.0 - (1.0 - CURSOR_CLICK_ANIMATION_SCALE) * easedT;
  } else {
    // Scale up phase (0.5 to 1.0)
    const t = (progress - 0.5) * 2; // 0 to 1
    const easedT = easeIn(t);
    return CURSOR_CLICK_ANIMATION_SCALE + (1.0 - CURSOR_CLICK_ANIMATION_SCALE) * easedT;
  }
}
