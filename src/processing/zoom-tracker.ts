import type { MouseEvent, ZoomConfig } from '../types';
import { SmoothValue, SmoothPosition2D } from './smooth-motion';

export interface ZoomRegion {
  timestamp: number;
  centerX: number;
  centerY: number;
  cropWidth: number;
  cropHeight: number;
  scale: number;
}

export interface VideoDimensions {
  width: number;
  height: number;
}

export interface ZoomSection {
  startTime: number;
  endTime: number;
  scale: number;
  centerX: number;
  centerY: number;
}

/**
 * Calculate zoom region based on mouse position and zoom config
 */
export function calculateZoomRegion(
  mouseX: number,
  mouseY: number,
  videoDimensions: VideoDimensions,
  zoomConfig: ZoomConfig
): ZoomRegion {
  const { level } = zoomConfig;

  // Calculate crop dimensions based on zoom level
  const cropWidth = videoDimensions.width / level;
  const cropHeight = videoDimensions.height / level;

  // Calculate center position
  const maxX = videoDimensions.width - cropWidth / 2;
  const minX = cropWidth / 2;
  const maxY = videoDimensions.height - cropHeight / 2;
  const minY = cropHeight / 2;

  // Clamp center position to stay within video bounds
  const centerX = Math.max(minX, Math.min(maxX, mouseX));
  const centerY = Math.max(minY, Math.min(maxY, mouseY));

  return {
    timestamp: 0, // Will be set by caller
    centerX,
    centerY,
    cropWidth,
    cropHeight,
    scale: level,
  };
}

/**
 * Detect zoom sections (static vs moving) based on mouse events
 */
export function detectZoomSections(
  events: MouseEvent[],
  videoDimensions: VideoDimensions,
  zoomConfig: ZoomConfig
): ZoomSection[] {
  if (events.length === 0) return [];

  const sections: ZoomSection[] = [];
  const deadZone = zoomConfig.deadZone || 15;
  const minStaticDuration = 300; // ms

  // Helper to create a section
  const createSection = (
    start: number,
    end: number,
    type: 'static' | 'moving',
    center?: { x: number, y: number }
  ): ZoomSection => {
    const isStatic = type === 'static';
    return {
      startTime: start,
      endTime: end,
      scale: isStatic ? zoomConfig.level : 1.0,
      // If static, use the detected center. If moving, center on the video (zoom out)
      centerX: isStatic && center ? center.x : videoDimensions.width / 2,
      centerY: isStatic && center ? center.y : videoDimensions.height / 2
    };
  };

  // Helper to get distance
  const getDist = (x1: number, y1: number, x2: number, y2: number) =>
    Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));

  // Initial state
  let currentType: 'static' | 'moving' = 'static';
  let sectionStart = events[0].timestamp;
  let sectionCenter = { x: events[0].x, y: events[0].y };
  let lastEventTime = events[0].timestamp;

  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    lastEventTime = event.timestamp;

    if (currentType === 'static') {
      const dist = getDist(sectionCenter.x, sectionCenter.y, event.x, event.y);

      if (dist > deadZone) {
        // Movement detected - end static section
        sections.push(createSection(sectionStart, event.timestamp, 'static', sectionCenter));

        // Start moving section
        currentType = 'moving';
        sectionStart = event.timestamp;
      }
    } else {
      // In moving section
      // Look ahead to see if we settle down
      let isStaticAhead = true;
      let lookAheadTime = 0;

      // Optimization: Don't scan too far
      const maxScan = 50;

      for (let j = i + 1; j < Math.min(events.length, i + maxScan); j++) {
        const next = events[j];
        if (getDist(event.x, event.y, next.x, next.y) > deadZone) {
          isStaticAhead = false;
          break;
        }
        lookAheadTime = next.timestamp - event.timestamp;
        if (lookAheadTime >= minStaticDuration) break;
      }

      if (isStaticAhead && lookAheadTime >= minStaticDuration) {
        // Found a new static spot - end moving section
        sections.push(createSection(sectionStart, event.timestamp, 'moving'));

        // Start static section
        currentType = 'static';
        sectionStart = event.timestamp;
        sectionCenter = { x: event.x, y: event.y };
      }
    }
  }

  // Add final section
  sections.push(createSection(sectionStart, lastEventTime, currentType, currentType === 'static' ? sectionCenter : undefined));

  return sections;
}

/**
 * Generate smoothed per-frame zoom regions from sections
 */
export function generateSmoothedZoom(
  sections: ZoomSection[],
  videoDimensions: VideoDimensions,
  zoomConfig: ZoomConfig,
  frameRate: number,
  videoDuration: number
): ZoomRegion[] {
  if (!zoomConfig.enabled || sections.length === 0) {
    const defaultRegion: ZoomRegion = {
      timestamp: 0,
      centerX: videoDimensions.width / 2,
      centerY: videoDimensions.height / 2,
      cropWidth: videoDimensions.width,
      cropHeight: videoDimensions.height,
      scale: 1.0,
    };
    return [defaultRegion];
  }

  const regions: ZoomRegion[] = [];
  const frameInterval = 1000 / frameRate;
  const totalFrames = Math.ceil(videoDuration / frameInterval);

  // Initialize smoothers
  // Start at 1.0x (no zoom) by default
  const smoothTime = 0.35; // Default mellow

  const scaleSmoother = new SmoothValue(1.0, smoothTime);
  const posSmoother = new SmoothPosition2D(videoDimensions.width / 2, videoDimensions.height / 2, smoothTime);

  for (let frame = 0; frame < totalFrames; frame++) {
    const time = frame * frameInterval;

    // Find current section
    const section = sections.find(s => time >= s.startTime && time <= s.endTime);

    // If no section found, use default (no zoom)
    const targetScale = section ? section.scale : 1.0;
    const targetCenterX = section ? section.centerX : videoDimensions.width / 2;
    const targetCenterY = section ? section.centerY : videoDimensions.height / 2;

    // Update smoothers with the target
    scaleSmoother.setTarget(targetScale);
    posSmoother.setTarget(targetCenterX, targetCenterY);

    const dt = frameInterval / 1000;
    const newScale = scaleSmoother.update(dt);
    const newPos = posSmoother.update(dt);

    // Create region
    // We pass newScale as 'level' to calculateZoomRegion
    const region = calculateZoomRegion(
      newPos.x,
      newPos.y,
      videoDimensions,
      { ...zoomConfig, level: newScale }
    );
    region.timestamp = time;
    regions.push(region);
  }
  return regions;
}

/**
 * Get zoom region for a specific timestamp
 */
export function getZoomRegionAtTimestamp(
  regions: ZoomRegion[],
  timestamp: number,
  tolerance: number = 16
): ZoomRegion | null {
  // Find the closest region
  let closest: ZoomRegion | null = null;
  let minDiff = Infinity;

  for (const region of regions) {
    const diff = Math.abs(region.timestamp - timestamp);
    if (diff < minDiff && diff <= tolerance) {
      minDiff = diff;
      closest = region;
    }
  }

  // If no exact match, interpolate between two regions
  if (!closest && regions.length > 0) {
    for (let i = 0; i < regions.length - 1; i++) {
      const r1 = regions[i];
      const r2 = regions[i + 1];

      if (timestamp >= r1.timestamp && timestamp <= r2.timestamp) {
        const t = (timestamp - r1.timestamp) / (r2.timestamp - r1.timestamp);
        return {
          timestamp,
          centerX: r1.centerX + (r2.centerX - r1.centerX) * t,
          centerY: r1.centerY + (r2.centerY - r1.centerY) * t,
          cropWidth: r1.cropWidth + (r2.cropWidth - r1.cropWidth) * t,
          cropHeight: r1.cropHeight + (r2.cropHeight - r1.cropHeight) * t,
          scale: r1.scale + (r2.scale - r1.scale) * t,
        };
      }
    }

    // Return first or last region if outside range
    if (timestamp < regions[0].timestamp) {
      return regions[0];
    }
    return regions[regions.length - 1];
  }

  return closest;
}
