import sharp from 'sharp';
import { existsSync, readFileSync } from 'fs';
import type { ZoomConfig, CursorConfig } from '../types';
import type { CursorKeyframe, EasingType } from '../types/metadata';
import { generateSmoothedZoom } from './zoom-tracker';
import { createLogger } from '../utils/logger';
import { applyCursorMotionBlur } from './motion-blur';
import { easeInOut, easeIn, easeOut } from './effects';
import { getCursorAssetFilePath } from './cursor-renderer';
import {
  BLACK_BACKGROUND,
  TRANSPARENT_BACKGROUND,
  PNG_QUALITY,
  PNG_COMPRESSION_LEVEL,
  SVG_DENSITY,
  CURSOR_STATIC_THRESHOLD,
  CURSOR_HIDE_AFTER_MS,
  CURSOR_LOOP_DURATION_SECONDS,
  CURSOR_CLICK_ANIMATION_DURATION_MS,
  CURSOR_CLICK_ANIMATION_SCALE,
} from '../utils/constants';

const logger = createLogger('SharpRenderer');

/**
 * Cursor hotspot offsets (x, y) within the 32x32 viewBox
 * These represent the click point within the cursor image
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

/**
 * Get cursor hotspot offset for a given shape
 */
function getCursorHotspot(shape: string): { x: number; y: number } {
  return CURSOR_HOTSPOT_MAP[shape] || CURSOR_HOTSPOT_MAP.arrow || { x: 10, y: 7 };
}

// Cache for prepared cursor images (shape+size -> buffer)
const cursorCache: Map<string, Buffer> = new Map();

/**
 * Clear the cursor cache (call between exports to free memory)
 */
export function clearCursorCache(): void {
  cursorCache.clear();
}

export interface FrameRenderOptions {
  frameWidth: number;
  frameHeight: number;
  outputWidth: number;
  outputHeight: number;
  cursorImagePath: string;
  cursorSize: number;
  cursorConfig?: CursorConfig;
  zoomConfig?: ZoomConfig;
  frameRate: number;
}

export interface FrameData {
  frameIndex: number;
  timestamp: number;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean; // Whether cursor should be visible
  cursorVelocityX: number; // For motion blur
  cursorVelocityY: number;
  cursorShape?: string; // Cursor shape for this frame (e.g., 'arrow', 'pointer', 'ibeam')
  clickAnimationScale?: number; // Scale factor for click animation (0-1)
  zoomCenterX?: number;
  zoomCenterY?: number;
  zoomLevel?: number;
  zoomVelocityX?: number; // For zoom motion blur
  zoomVelocityY?: number;
}

/**
 * Render a single frame with cursor overlay and zoom effects using Sharp
 */
export async function renderFrame(
  inputPath: string,
  outputPath: string,
  frameData: FrameData,
  options: FrameRenderOptions
): Promise<void> {
  const {
    frameWidth,
    frameHeight,
    outputWidth,
    outputHeight,
    cursorImagePath,
    cursorSize,
    cursorConfig,
    zoomConfig,
    frameRate,
  } = options;

  // Load the frame
  let pipeline = sharp(inputPath);

  // Track current frame dimensions (may change with zoom)
  let currentFrameWidth = frameWidth;
  let currentFrameHeight = frameHeight;

  // Track offsets for cursor positioning (for letterboxing/pillarboxing)
  let offsetX = 0;
  let offsetY = 0;

  // Apply zoom if enabled
  if (zoomConfig?.enabled && frameData.zoomLevel && frameData.zoomLevel > 1) {
    const zoomLevel = frameData.zoomLevel;
    const centerX = frameData.zoomCenterX ?? frameData.cursorX;
    const centerY = frameData.zoomCenterY ?? frameData.cursorY;

    // Calculate crop region
    const cropWidth = Math.round(frameWidth / zoomLevel);
    const cropHeight = Math.round(frameHeight / zoomLevel);

    // Center the crop on the cursor position, clamped to frame bounds
    let cropX = Math.round(centerX - cropWidth / 2);
    let cropY = Math.round(centerY - cropHeight / 2);

    // Clamp to bounds
    cropX = Math.max(0, Math.min(frameWidth - cropWidth, cropX));
    cropY = Math.max(0, Math.min(frameHeight - cropHeight, cropY));

    // Extract the zoomed region
    pipeline = pipeline.extract({
      left: cropX,
      top: cropY,
      width: cropWidth,
      height: cropHeight,
    });

    // Update current frame dimensions to crop size
    currentFrameWidth = cropWidth;
    currentFrameHeight = cropHeight;

    // Adjust cursor position relative to the crop
    frameData.cursorX = frameData.cursorX - cropX;
    frameData.cursorY = frameData.cursorY - cropY;
  }

  if (frameData.frameIndex === 0) {
    logger.debug(`renderFrame: frameWidth=${frameWidth}, frameHeight=${frameHeight}, outputWidth=${outputWidth}, outputHeight=${outputHeight}, currentFrameWidth=${currentFrameWidth}, currentFrameHeight=${currentFrameHeight}`);
    logger.debug(`renderFrame: cursorX=${frameData.cursorX}, cursorY=${frameData.cursorY} (before scaling)`);
  }

  // If output dimensions match frame dimensions exactly, no scaling needed
  // Otherwise, calculate aspect-ratio preserving scale
  let scale = 1.0;
  if (outputWidth !== currentFrameWidth || outputHeight !== currentFrameHeight) {
    const scaleX = outputWidth / currentFrameWidth;
    const scaleY = outputHeight / currentFrameHeight;
    scale = Math.min(scaleX, scaleY);

    // Calculate actual display dimensions after aspect-ratio preserving scaling
    const actualDisplayWidth = currentFrameWidth * scale;
    const actualDisplayHeight = currentFrameHeight * scale;

    // Calculate offsets for letterboxing/pillarboxing (Sharp's 'contain' centers automatically)
    offsetX = (outputWidth - actualDisplayWidth) / 2;
    offsetY = (outputHeight - actualDisplayHeight) / 2;
  } else {
    // No scaling needed - output matches frame exactly
    offsetX = 0;
    offsetY = 0;
  }

  // Resize with aspect ratio preservation (using 'contain' fit)
  // Sharp will automatically preserve aspect ratio, add background, and center the image
  // Using 'mitchell' kernel - good balance of speed and quality (faster than lanczos3)
  pipeline = pipeline.resize(outputWidth, outputHeight, {
    fit: 'contain',
    kernel: 'mitchell',
    background: BLACK_BACKGROUND, // Black background for letterboxing
  });

  // Scale cursor position using the same scale factor and offsets as the preview
  // Cursor coordinates are already in video coordinate space (0 to frameWidth, 0 to frameHeight)
  const originalCursorX = frameData.cursorX;
  const originalCursorY = frameData.cursorY;
  frameData.cursorX = Math.round(frameData.cursorX * scale + offsetX);
  frameData.cursorY = Math.round(frameData.cursorY * scale + offsetY);

  // Log first frame cursor position after scaling
  if (frameData.frameIndex === 0) {
    logger.debug(`renderFrame: cursorX=${frameData.cursorX}, cursorY=${frameData.cursorY} (after scaling: scale=${scale}, offsetX=${offsetX}, offsetY=${offsetY})`);
  }

  // Calculate click animation scale (default to 1.0 if not set)
  const clickAnimationScale = frameData.clickAnimationScale ?? 1.0;

  // Scale cursor size to match the video scale and click animation (matching preview logic)
  const scaledCursorSize = Math.round(cursorSize * scale * clickAnimationScale);

  // Determine cursor shape for this frame (use per-frame shape or fallback to config)
  const cursorShape = frameData.cursorShape || cursorConfig?.shape || 'arrow';

  // Prepare cursor overlay (only if visible)
  let cursorBuffer: Buffer | null = null;
  if (frameData.cursorVisible) {
    try {
      // Check cache first (key is shape + scaled size)
      const cacheKey = `${cursorShape}_${scaledCursorSize}`;
      cursorBuffer = cursorCache.get(cacheKey) || null;

      if (!cursorBuffer) {
        // Get cursor asset path for this shape
        const shapeCursorPath = getCursorAssetFilePath(cursorShape);
        const actualCursorPath = shapeCursorPath && existsSync(shapeCursorPath) ? shapeCursorPath : cursorImagePath;

        if (existsSync(actualCursorPath)) {
          // Resize cursor to the scaled target size
          cursorBuffer = await sharp(actualCursorPath, { density: SVG_DENSITY })
            .resize(scaledCursorSize, scaledCursorSize, { fit: 'contain', background: TRANSPARENT_BACKGROUND })
            .png()
            .toBuffer();

          // Cache the result (without motion blur - that's applied per-frame)
          cursorCache.set(cacheKey, cursorBuffer);
        }
      }

      // Apply motion blur if enabled (blur is applied relative to cursor speed)
      // Motion blur must be applied per-frame, so we clone the cached buffer
      if (options.cursorConfig?.motionBlur?.enabled && cursorBuffer) {
        const motionBlurStrength = options.cursorConfig.motionBlur.strength ?? 0.5;

        // Velocity is already in pixels per second from frame data
        // Pass it directly to motion blur function which scales blur based on speed
        cursorBuffer = await applyCursorMotionBlur(
          cursorBuffer,
          frameData.cursorVelocityX,
          frameData.cursorVelocityY,
          motionBlurStrength,
          options.frameRate
        );
      }
    } catch (error) {
      logger.warn('Failed to load cursor image:', error);
    }
  }

  // Calculate cursor overlay position accounting for hotspot offset
  // The cursor hotspot (click point) varies by cursor type and needs to align with cursor coordinates
  const hotspot = getCursorHotspot(cursorShape);
  // Scale hotspot from 32x32 viewBox to the actual cursor size
  const hotspotOffsetX = Math.round(hotspot.x * (scaledCursorSize / 32));
  const hotspotOffsetY = Math.round(hotspot.y * (scaledCursorSize / 32));
  // Position cursor so hotspot aligns with cursor coordinates
  const cursorLeft = Math.round(frameData.cursorX - hotspotOffsetX);
  const cursorTop = Math.round(frameData.cursorY - hotspotOffsetY);

  // Composite cursor overlay
  if (cursorBuffer) {
    // Ensure cursor is within bounds (allow hotspot to reach edges)
    const clampedLeft = Math.max(-hotspotOffsetX, Math.min(outputWidth - scaledCursorSize + hotspotOffsetX, cursorLeft));
    const clampedTop = Math.max(-hotspotOffsetY, Math.min(outputHeight - scaledCursorSize + hotspotOffsetY, cursorTop));

    pipeline = pipeline.composite([
      {
        input: cursorBuffer,
        left: clampedLeft,
        top: clampedTop,
        blend: 'over',
      },
    ]);
  }

  // Write output
  await pipeline.png({ quality: PNG_QUALITY, compressionLevel: PNG_COMPRESSION_LEVEL }).toFile(outputPath);
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
 * Create frame data directly from cursor keyframes (for metadata-based export)
 * Uses the same interpolation logic as the preview to ensure timing matches exactly
 */
export function createFrameDataFromKeyframes(
  cursorKeyframes: CursorKeyframe[],
  zoomSections: import('./zoom-tracker').ZoomSection[],
  frameRate: number,
  videoDuration: number,
  videoDimensions: { width: number; height: number },
  cursorConfig?: CursorConfig,
  zoomConfig?: ZoomConfig,
  clicks?: Array<{ timestamp: number; action: string }>
): FrameData[] {
  const frameInterval = 1000 / frameRate;
  const totalFrames = Math.ceil(videoDuration / frameInterval);
  const frameDataList: FrameData[] = [];

  // Pre-calculate smoothed zoom regions from sections
  let zoomRegions: import('./zoom-tracker').ZoomRegion[] = [];
  if (zoomConfig?.enabled && zoomSections.length > 0) {
    zoomRegions = generateSmoothedZoom(
      zoomSections,
      videoDimensions,
      zoomConfig,
      frameRate,
      videoDuration
    );
  }

  // Convert frame interval to seconds for velocity calculation
  const deltaTime = frameInterval / 1000;

  // Initialize position tracking
  const initialX = cursorKeyframes.length > 0 ? cursorKeyframes[0].x : videoDimensions.width / 2;
  const initialY = cursorKeyframes.length > 0 ? cursorKeyframes[0].y : videoDimensions.height / 2;

  // Interpolate cursor position function (matching preview logic)
  const interpolateCursor = (timestamp: number): { x: number; y: number; shape?: string } | null => {
    if (cursorKeyframes.length === 0) return null;
    if (cursorKeyframes.length === 1) {
      return { x: cursorKeyframes[0].x, y: cursorKeyframes[0].y, shape: cursorKeyframes[0].shape };
    }

    // Find bracketing keyframes
    let prev: typeof cursorKeyframes[0] | null = null;
    let next: typeof cursorKeyframes[0] | null = null;

    for (let i = 0; i < cursorKeyframes.length; i++) {
      if (cursorKeyframes[i].timestamp <= timestamp) {
        prev = cursorKeyframes[i];
        next = cursorKeyframes[i + 1] || cursorKeyframes[i];
      } else {
        if (!prev) {
          prev = cursorKeyframes[0];
          next = cursorKeyframes[0];
        } else {
          next = cursorKeyframes[i];
        }
        break;
      }
    }

    if (!prev || !next) return null;
    if (prev.timestamp === next.timestamp) {
      return { x: prev.x, y: prev.y, shape: prev.shape };
    }

    // Interpolate with easing
    const timeDiff = next.timestamp - prev.timestamp;
    const t = timeDiff > 0 ? (timestamp - prev.timestamp) / timeDiff : 0;

    // Apply easing (matching preview logic exactly)
    const easingType: EasingType = (prev.easing || 'linear') as EasingType;
    let easedT: number;
    switch (easingType) {
      case 'linear':
        easedT = t;
        break;
      case 'easeIn':
        easedT = easeIn(t);
        break;
      case 'easeOut':
        easedT = easeOut(t);
        break;
      case 'easeInOut':
      default:
        easedT = easeInOut(t);
        break;
    }

    return {
      x: prev.x + (next.x - prev.x) * easedT,
      y: prev.y + (next.y - prev.y) * easedT,
      shape: prev.shape, // Use shape from previous keyframe (don't interpolate)
    };
  };

  // Interpolate zoom function using pre-calculated regions
  const interpolateZoom = (timestamp: number): { centerX: number; centerY: number; level: number } | null => {
    if (!zoomConfig?.enabled || zoomRegions.length === 0) {
      return { centerX: videoDimensions.width / 2, centerY: videoDimensions.height / 2, level: 1.0 };
    }

    const frameIdx = Math.floor(timestamp / frameInterval);
    if (frameIdx >= 0 && frameIdx < zoomRegions.length) {
      const region = zoomRegions[frameIdx];
      return { centerX: region.centerX, centerY: region.centerY, level: region.scale };
    }

    return { centerX: videoDimensions.width / 2, centerY: videoDimensions.height / 2, level: 1.0 };
  };

  // Previous positions for velocity calculation
  let prevCursorX = initialX;
  let prevCursorY = initialY;
  let prevZoomCenterX = videoDimensions.width / 2;
  let prevZoomCenterY = videoDimensions.height / 2;

  // Track cursor movement for "hide when static"
  const staticThreshold = CURSOR_STATIC_THRESHOLD;
  let lastMovementTime = 0;
  const hideAfterMs = CURSOR_HIDE_AFTER_MS;

  if (cursorKeyframes.length > 0) {
    logger.debug(`Creating frame data from ${cursorKeyframes.length} cursor keyframes`);
    logger.debug(`Video dimensions: ${videoDimensions.width}x${videoDimensions.height}`);
    logger.debug(`First keyframe: timestamp=${cursorKeyframes[0].timestamp}, x=${cursorKeyframes[0].x}, y=${cursorKeyframes[0].y}`);
  }

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const timestamp = Math.min(frameIndex * frameInterval, videoDuration);

    // Get cursor position directly from keyframes (matching preview exactly)
    const cursorPos = interpolateCursor(timestamp);
    if (!cursorPos) continue;

    // Clamp to video bounds
    const cursorX = Math.max(0, Math.min(videoDimensions.width, cursorPos.x));
    const cursorY = Math.max(0, Math.min(videoDimensions.height, cursorPos.y));

    // Calculate velocity for motion blur
    const velocityX = (cursorX - prevCursorX) / deltaTime;
    const velocityY = (cursorY - prevCursorY) / deltaTime;

    // Check if cursor is moving (for hide when static)
    const movementDistance = Math.sqrt(
      Math.pow(cursorX - prevCursorX, 2) +
      Math.pow(cursorY - prevCursorY, 2)
    );

    if (movementDistance > staticThreshold) {
      lastMovementTime = timestamp;
    }

    prevCursorX = cursorX;
    prevCursorY = cursorY;

    // Determine cursor visibility
    let cursorVisible = true;
    if (cursorConfig?.hideWhenStatic) {
      cursorVisible = (timestamp - lastMovementTime) < hideAfterMs;
    }

    // Calculate click animation scale
    const clickAnimationScale = clicks ? calculateClickAnimationScale(timestamp, clicks) : 1.0;

    // Get cursor shape
    const cursorShape = cursorPos.shape || cursorConfig?.shape || 'arrow';

    // Get zoom data
    const zoomData = interpolateZoom(timestamp);

    if (zoomConfig?.enabled && zoomData) {
      const zoomVelocityX = (zoomData.centerX - prevZoomCenterX) / deltaTime;
      const zoomVelocityY = (zoomData.centerY - prevZoomCenterY) / deltaTime;
      prevZoomCenterX = zoomData.centerX;
      prevZoomCenterY = zoomData.centerY;

      frameDataList.push({
        frameIndex,
        timestamp,
        cursorX,
        cursorY,
        cursorVisible,
        cursorVelocityX: velocityX,
        cursorVelocityY: velocityY,
        cursorShape,
        clickAnimationScale,
        zoomCenterX: zoomData.centerX,
        zoomCenterY: zoomData.centerY,
        zoomLevel: zoomData.level,
        zoomVelocityX,
        zoomVelocityY,
      });
    } else {
      frameDataList.push({
        frameIndex,
        timestamp,
        cursorX,
        cursorY,
        cursorVisible,
        cursorVelocityX: velocityX,
        cursorVelocityY: velocityY,
        cursorShape,
        clickAnimationScale,
      });
    }
  }

  return frameDataList;
}

/**
 * Load and prepare cursor image, converting SVG to PNG if needed
 */
export async function prepareCursorImage(
  cursorPath: string,
  size: number,
  outputPath: string
): Promise<string> {
  if (!existsSync(cursorPath)) {
    throw new Error(`Cursor image not found: ${cursorPath}`);
  }

  const isSvg = cursorPath.toLowerCase().endsWith('.svg');

  if (isSvg) {
    // Convert SVG to PNG using Sharp
    const svgBuffer = readFileSync(cursorPath);
    await sharp(svgBuffer, { density: SVG_DENSITY })
      .resize(size, size, { fit: 'contain', background: TRANSPARENT_BACKGROUND })
      .png()
      .toFile(outputPath);
    return outputPath;
  } else {
    // Already a raster image, just resize
    await sharp(cursorPath)
      .resize(size, size, { fit: 'contain', background: TRANSPARENT_BACKGROUND })
      .png()
      .toFile(outputPath);
    return outputPath;
  }
}
