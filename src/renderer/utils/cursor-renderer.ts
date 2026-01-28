import type { RecordingMetadata } from '../../types/metadata';
import { SmoothPosition2D } from '../../processing/smooth-motion';
import {
  CURSOR_SMOOTH_TIME,
  CURSOR_HOTSPOT_MAP,
  getCursorHotspot,
  interpolateCursorPosition,
  calculateClickAnimationScale,
  CursorTypeStabilizer,
} from '../../processing/cursor-utils';
import { DEFAULT_CURSOR_SIZE } from '../../utils/constants';

/**
 * Cursor position smoother for glide effect
 */
let cursorSmoother: SmoothPosition2D | null = null;
let cursorTypeStabilizer: CursorTypeStabilizer | null = null;
let lastFrameTime: number = 0;

/**
 * Reset smoothing state when seeking or loading new video
 */
export function resetCursorSmoothing(): void {
  cursorSmoother = null;
  cursorTypeStabilizer = null;
  lastFrameTime = 0;
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

// CURSOR_HOTSPOT_MAP is now imported from cursor-utils

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
  const size = cursorPos.size || config.size || DEFAULT_CURSOR_SIZE;
  const rawShape = cursorPos.shape || config.shape || 'arrow';

  // Initialize cursor type stabilizer if needed
  if (!cursorTypeStabilizer) {
    cursorTypeStabilizer = new CursorTypeStabilizer(rawShape);
    cursorTypeStabilizer.setKeyframes(metadata.cursor.keyframes);
  }

  // Stabilize cursor shape using look-ahead to prevent flickering
  const shape = cursorTypeStabilizer.update(rawShape, timestamp);

  // Check if currently clicking (within animation duration)
  const clicks = metadata.clicks || [];
  const clickAnimationScale = calculateClickAnimationScale(timestamp, clicks);

  // Apply smooth glide effect to cursor position
  // Initialize smoother if needed
  if (!cursorSmoother) {
    cursorSmoother = new SmoothPosition2D(cursorPos.x, cursorPos.y, CURSOR_SMOOTH_TIME);
    lastFrameTime = performance.now();
  }

  // Calculate delta time for smooth updates
  const currentFrameTime = performance.now();
  const deltaTime = Math.min((currentFrameTime - lastFrameTime) / 1000, 0.1); // Cap at 100ms
  lastFrameTime = currentFrameTime;

  // Update smoother and get smoothed position
  cursorSmoother.setTarget(cursorPos.x, cursorPos.y);
  const smoothedPos = cursorSmoother.update(deltaTime);

  // Use smoothed position for glide effect
  const x = smoothedPos.x * scale + offsetX;
  const y = smoothedPos.y * scale + offsetY;

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

// getCursorHotspot is now imported from cursor-utils

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

