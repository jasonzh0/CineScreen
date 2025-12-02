import type { MouseEvent } from '../types';
import {
  DEFAULT_TIME_DIFF_MS,
  ADAPTIVE_SMOOTHING_SPEED_THRESHOLD,
  ADAPTIVE_SMOOTHING_FACTOR,
  DUPLICATE_POSITION_THRESHOLD,
} from '../utils/constants';

/**
 * Apply smoothing to mouse movement events using exponential moving average
 * Improved with velocity-based adaptive smoothing
 */
export function smoothMouseMovement(
  events: MouseEvent[],
  smoothingFactor: number
): MouseEvent[] {
  if (events.length === 0 || smoothingFactor === 0) {
    return events;
  }

  const smoothed: MouseEvent[] = [];
  let lastX = events[0].x;
  let lastY = events[0].y;
  let lastVelocity = { x: 0, y: 0 };

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    
    // Calculate velocity
    const timeDiff = i > 0 ? event.timestamp - events[i - 1].timestamp : DEFAULT_TIME_DIFF_MS;
    const velocity = {
      x: timeDiff > 0 ? (event.x - lastX) / timeDiff : 0,
      y: timeDiff > 0 ? (event.y - lastY) / timeDiff : 0,
    };

    // Adaptive smoothing: less smoothing for fast movements
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
    const adaptiveFactor = Math.min(1, speed / ADAPTIVE_SMOOTHING_SPEED_THRESHOLD);
    const effectiveSmoothing = smoothingFactor * (1 - adaptiveFactor * ADAPTIVE_SMOOTHING_FACTOR);

    // Exponential moving average with velocity consideration
    const smoothedX = lastX + (event.x - lastX) * (1 - effectiveSmoothing);
    const smoothedY = lastY + (event.y - lastY) * (1 - effectiveSmoothing);

    smoothed.push({
      ...event,
      x: smoothedX,
      y: smoothedY,
    });

    lastX = smoothedX;
    lastY = smoothedY;
    lastVelocity = velocity;
  }

  return smoothed;
}

/**
 * Cubic interpolation using Catmull-Rom spline for smoother curves
 */
function cubicInterpolate(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Interpolate mouse positions for missing frames with improved algorithms
 * Uses cubic interpolation for smoother motion
 */
export function interpolateMousePositions(
  events: MouseEvent[],
  targetFrameRate: number,
  duration: number
): MouseEvent[] {
  if (events.length === 0) {
    return events;
  }

  const frameInterval = 1000 / targetFrameRate;
  const totalFrames = Math.ceil(duration / frameInterval);
  const interpolated: MouseEvent[] = [];

  let eventIndex = 0;

  for (let frame = 0; frame < totalFrames; frame++) {
    const targetTime = frame * frameInterval;

    // Find the two events that bracket this time
    while (
      eventIndex < events.length - 1 &&
      events[eventIndex + 1].timestamp < targetTime
    ) {
      eventIndex++;
    }

    if (eventIndex >= events.length - 1) {
      // Use last event
      interpolated.push({
        ...events[events.length - 1],
        timestamp: targetTime,
      });
    } else {
      const event1 = events[eventIndex];
      const event2 = events[eventIndex + 1];
      const timeDiff = event2.timestamp - event1.timestamp;
      const t = timeDiff > 0 ? (targetTime - event1.timestamp) / timeDiff : 0;

      // Use cubic interpolation if we have enough points
      if (eventIndex > 0 && eventIndex < events.length - 2) {
        const p0 = events[eventIndex - 1];
        const p1 = event1;
        const p2 = event2;
        const p3 = events[eventIndex + 2];

        interpolated.push({
          timestamp: targetTime,
          x: cubicInterpolate(p0.x, p1.x, p2.x, p3.x, t),
          y: cubicInterpolate(p0.y, p1.y, p2.y, p3.y, t),
          action: event1.action,
        });
      } else {
        // Fall back to linear interpolation at boundaries
        interpolated.push({
          timestamp: targetTime,
          x: event1.x + (event2.x - event1.x) * t,
          y: event1.y + (event2.y - event1.y) * t,
          action: event1.action,
        });
      }
    }
  }

  return interpolated;
}

/**
 * Filter out duplicate positions (within threshold)
 */
export function removeDuplicatePositions(
  events: MouseEvent[],
  threshold: number = DUPLICATE_POSITION_THRESHOLD
): MouseEvent[] {
  if (events.length === 0) {
    return events;
  }

  const filtered: MouseEvent[] = [events[0]];

  for (let i = 1; i < events.length; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = events[i];

    const distance = Math.sqrt(
      Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2)
    );

    if (distance > threshold) {
      filtered.push(curr);
    }
  }

  return filtered;
}

/**
 * Easing function for smooth transitions (ease-in-out)
 * @param t Progress from 0 to 1
 * @returns Eased progress from 0 to 1
 */
export function easeInOut(t: number): number {
  return t < 0.5
    ? 2 * t * t
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Easing function for smooth transitions (ease-out)
 * @param t Progress from 0 to 1
 * @returns Eased progress from 0 to 1
 */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Easing function for smooth transitions (ease-in)
 * @param t Progress from 0 to 1
 * @returns Eased progress from 0 to 1
 */
export function easeIn(t: number): number {
  return t * t * t;
}

