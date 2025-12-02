import type { MouseEvent } from '../types';

/**
 * Apply smoothing to mouse movement events using exponential moving average
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

  for (const event of events) {
    // Exponential moving average
    const smoothedX = lastX + (event.x - lastX) * (1 - smoothingFactor);
    const smoothedY = lastY + (event.y - lastY) * (1 - smoothingFactor);

    smoothed.push({
      ...event,
      x: smoothedX,
      y: smoothedY,
    });

    lastX = smoothedX;
    lastY = smoothedY;
  }

  return smoothed;
}

/**
 * Interpolate mouse positions for missing frames
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
      // Interpolate between two events
      const event1 = events[eventIndex];
      const event2 = events[eventIndex + 1];
      const timeDiff = event2.timestamp - event1.timestamp;
      const t = timeDiff > 0 ? (targetTime - event1.timestamp) / timeDiff : 0;

      interpolated.push({
        timestamp: targetTime,
        x: event1.x + (event2.x - event1.x) * t,
        y: event1.y + (event2.y - event1.y) * t,
        action: event1.action,
      });
    }
  }

  return interpolated;
}

/**
 * Filter out duplicate positions (within threshold)
 */
export function removeDuplicatePositions(
  events: MouseEvent[],
  threshold: number = 1
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

