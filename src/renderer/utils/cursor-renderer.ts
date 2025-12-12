import type { RecordingMetadata, CursorKeyframe, EasingType } from '../../types/metadata';
import { easeInOut, easeIn, easeOut } from '../../processing/effects';
import {
  CURSOR_CLICK_ANIMATION_DURATION_MS,
  CURSOR_CLICK_ANIMATION_SCALE,
} from '../../utils/constants';

/**
 * Reset smoothing state (no-op, kept for API compatibility)
 */
export function resetCursorSmoothing(): void {
  // No smoothing state to reset - cursor position comes directly from keyframes
}

// Import cursor SVG assets (using new asset file names)
import defaultSvg from '../../assets/default.svg';
import handpointingSvg from '../../assets/handpointing.svg';
import handopenSvg from '../../assets/handopen.svg';
import handgrabbingSvg from '../../assets/handgrabbing.svg';
import moveSvg from '../../assets/move.svg';
import copySvg from '../../assets/copy.svg';
import notallowedSvg from '../../assets/notallowed.svg';
import helpSvg from '../../assets/help.svg';
import textcursorSvg from '../../assets/textcursor.svg';
import textcursorverticalSvg from '../../assets/textcursorvertical.svg';
import crossSvg from '../../assets/cross.svg';
import contextmenumenuSvg from '../../assets/contextualmenu.svg';
import resizeleftrightSvg from '../../assets/resizeleftright.svg';
import resizeupdownSvg from '../../assets/resizeupdown.svg';
import resizenortheastsouthwestSvg from '../../assets/resizenortheastsouthwest.svg';
import resizenorthwestsoutheastSvg from '../../assets/resizenorthwestsoutheast.svg';
import zoominSvg from '../../assets/zoomin.svg';
import zoomoutSvg from '../../assets/zoomout.svg';
import poofSvg from '../../assets/poof.svg';
import screenshotselectionSvg from '../../assets/screenshotselection.svg';

/**
 * Map cursor shape names to SVG imports
 */
const CURSOR_SVG_MAP: Record<string, string> = {
  // Standard cursors
  arrow: defaultSvg,
  pointer: handpointingSvg,
  hand: handopenSvg,
  openhand: handopenSvg,
  closedhand: handgrabbingSvg,
  crosshair: crossSvg,
  ibeam: textcursorSvg,
  ibeamvertical: textcursorverticalSvg,

  // Resize cursors
  move: moveSvg,
  resizeleft: resizeleftrightSvg,
  resizeright: resizeleftrightSvg,
  resizeleftright: resizeleftrightSvg,
  resizeup: resizeupdownSvg,
  resizedown: resizeupdownSvg,
  resizeupdown: resizeupdownSvg,
  resize: resizenortheastsouthwestSvg,
  resizenortheast: resizenortheastsouthwestSvg,
  resizesouthwest: resizenortheastsouthwestSvg,
  resizenorthwest: resizenorthwestsoutheastSvg,
  resizesoutheast: resizenorthwestsoutheastSvg,

  // Action cursors
  copy: copySvg,
  dragcopy: copySvg,
  draglink: defaultSvg,
  help: helpSvg,
  notallowed: notallowedSvg,
  contextmenu: contextmenumenuSvg,
  poof: poofSvg,

  // Zoom/screenshot cursors
  zoomin: zoominSvg,
  zoomout: zoomoutSvg,
  screenshot: screenshotselectionSvg,
};

/**
 * Cursor hotspot offsets (x, y) from SVG transform attributes
 * These represent the click point within the 32x32 viewBox
 */
const CURSOR_HOTSPOT_MAP: Record<string, { x: number; y: number }> = {
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

// Cache for loaded cursor images
const cursorImageCache: Map<string, HTMLImageElement> = new Map();

/**
 * Load cursor image from SVG path
 */
function loadCursorImage(svgPath: string): Promise<HTMLImageElement> {
  const cached = cursorImageCache.get(svgPath);
  if (cached) {
    if (cached.complete && cached.naturalWidth > 0) {
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      cached.onload = () => resolve(cached);
      cached.onerror = reject;
    });
  }

  const img = new Image();
  cursorImageCache.set(svgPath, img);

  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = svgPath;
  });
}

/**
 * Get cursor image for a shape (returns cached image or arrow fallback)
 */
function getCursorImage(shape: string): HTMLImageElement | null {
  const svgPath = CURSOR_SVG_MAP[shape] || CURSOR_SVG_MAP.arrow;
  const cached = cursorImageCache.get(svgPath);

  if (cached && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }

  // Fallback to arrow if specific shape not ready
  if (shape !== 'arrow') {
    const arrowCached = cursorImageCache.get(CURSOR_SVG_MAP.arrow);
    if (arrowCached && arrowCached.complete && arrowCached.naturalWidth > 0) {
      return arrowCached;
    }
  }

  return null;
}

/**
 * Preload all cursor images
 */
function preloadCursorImages(): void {
  const uniqueSvgs = [...new Set(Object.values(CURSOR_SVG_MAP))];
  uniqueSvgs.forEach(svg => loadCursorImage(svg).catch(() => {}));
}

// Start preloading immediately
preloadCursorImages();

/**
 * Apply easing function based on type
 */
function applyEasing(t: number, easing: EasingType): number {
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
 * Interpolate cursor position between keyframes
 */
export function interpolateCursorPosition(
  keyframes: CursorKeyframe[],
  timestamp: number
): { x: number; y: number; size?: number; shape?: string; color?: string } | null {
  if (keyframes.length === 0) return null;
  if (keyframes.length === 1) {
    const kf = keyframes[0];
    return { x: kf.x, y: kf.y, size: kf.size, shape: kf.shape, color: kf.color };
  }

  // Find the two keyframes that bracket this timestamp
  let prevKeyframe: CursorKeyframe | null = null;
  let nextKeyframe: CursorKeyframe | null = null;

  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].timestamp <= timestamp) {
      prevKeyframe = keyframes[i];
      nextKeyframe = keyframes[i + 1] || keyframes[i];
    } else {
      if (!prevKeyframe) {
        prevKeyframe = keyframes[0];
        nextKeyframe = keyframes[0];
      } else {
        nextKeyframe = keyframes[i];
      }
      break;
    }
  }

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
      color: prevKeyframe.color,
    };
  }

  // Interpolate between keyframes
  const timeDiff = nextKeyframe.timestamp - prevKeyframe.timestamp;
  const t = timeDiff > 0 ? (timestamp - prevKeyframe.timestamp) / timeDiff : 0;
  // Use easing from start keyframe, or default to linear for smooth motion
  // (easeInOut between many keyframes causes stuttering)
  const easingType: EasingType = prevKeyframe.easing || 'linear';
  const easedT = applyEasing(t, easingType);

  const x = prevKeyframe.x + (nextKeyframe.x - prevKeyframe.x) * easedT;
  const y = prevKeyframe.y + (nextKeyframe.y - prevKeyframe.y) * easedT;
  const size = prevKeyframe.size !== undefined && nextKeyframe.size !== undefined
    ? prevKeyframe.size + (nextKeyframe.size - prevKeyframe.size) * easedT
    : prevKeyframe.size || nextKeyframe.size;

  return {
    x,
    y,
    size,
    shape: prevKeyframe.shape || nextKeyframe.shape,
    color: prevKeyframe.color || nextKeyframe.color,
  };
}

/**
 * Calculate cursor click animation scale based on time since click
 * Returns 1.0 (no scale) if no click is active, or scale value (0-1) during animation
 */
function calculateClickAnimationScale(
  timestamp: number,
  clicks: Array<{ timestamp: number; action: string }>
): number {
  // Find the most recent click "down" event within animation duration
  const clickDownEvents = clicks.filter(c => c.action === 'down');
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

/**
 * Render cursor on canvas
 */
export function renderCursor(
  canvas: HTMLCanvasElement,
  metadata: RecordingMetadata,
  timestamp: number,
  videoWidth: number,
  videoHeight: number,
  displayWidth: number,
  displayHeight: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Get cursor position at current timestamp (no offset - direct match with video)
  const cursorPos = interpolateCursorPosition(metadata.cursor.keyframes, timestamp);
  if (!cursorPos) return;

  // Calculate uniform scale factor to maintain aspect ratio
  // Use the smaller scale to ensure everything fits within the display
  const scaleX = displayWidth / videoWidth;
  const scaleY = displayHeight / videoHeight;
  const scale = Math.min(scaleX, scaleY);

  // Calculate actual video display size (may have letterboxing/pillarboxing)
  const actualDisplayWidth = videoWidth * scale;
  const actualDisplayHeight = videoHeight * scale;
  const offsetX = (displayWidth - actualDisplayWidth) / 2;
  const offsetY = (displayHeight - actualDisplayHeight) / 2;

  // Get cursor config
  const config = metadata.cursor.config;
  const size = cursorPos.size || config.size || 60;
  const shape = cursorPos.shape || config.shape || 'arrow';

  // Check if currently clicking (within animation duration)
  const clickAnimationScale = calculateClickAnimationScale(timestamp, metadata.clicks || []);

  // Use cursor position directly from keyframes (no additional smoothing)
  // Keyframes already contain high-frequency telemetry data with linear interpolation
  const x = cursorPos.x * scale + offsetX;
  const y = cursorPos.y * scale + offsetY;

  // Scale cursor size (base scale * click animation scale)
  const cursorSize = size * scale * clickAnimationScale;

  // Draw cursor using actual SVG assets
  drawCursorShape(ctx, x, y, cursorSize, shape);
}

/**
 * Draw a simple arrow cursor as fallback
 */
function drawFallbackArrowCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
): void {
  const scale = size / 28; // Match SVG viewBox size
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 * scale;

  ctx.beginPath();
  // Match the cursor.svg path approximately
  ctx.moveTo(x + 8.2 * scale, y + 4.9 * scale);
  ctx.lineTo(x + 8.2 * scale, y + 20.9 * scale);
  ctx.lineTo(x + 12.6 * scale, y + 16.6 * scale);
  ctx.lineTo(x + 13 * scale, y + 16.5 * scale);
  ctx.lineTo(x + 19.8 * scale, y + 16.5 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/**
 * Get hotspot offset for a cursor shape
 * Returns the position within the cursor image where the click point should be
 */
function getCursorHotspot(shape: string): { x: number; y: number } {
  return CURSOR_HOTSPOT_MAP[shape] || CURSOR_HOTSPOT_MAP.arrow || { x: 10, y: 7 };
}

/**
 * Draw cursor shape on canvas using actual SVG assets
 * The cursor is positioned so that its hotspot aligns with (x, y)
 */
function drawCursorShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shape: string
): void {
  ctx.save();

  const cursorImage = getCursorImage(shape);
  const hotspot = getCursorHotspot(shape);

  // SVG viewBox is 32x32, scale hotspot to current cursor size
  const scale = size / 32;
  const hotspotOffsetX = hotspot.x * scale;
  const hotspotOffsetY = hotspot.y * scale;

  // Draw cursor so that the hotspot aligns with (x, y)
  const drawX = x - hotspotOffsetX;
  const drawY = y - hotspotOffsetY;

  if (cursorImage) {
    ctx.drawImage(cursorImage, drawX, drawY, size, size);
  } else {
    drawFallbackArrowCursor(ctx, drawX, drawY, size);
  }

  ctx.restore();
}

