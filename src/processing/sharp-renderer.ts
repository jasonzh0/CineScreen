import sharp from 'sharp';
import { existsSync, readFileSync } from 'fs';
import type { MouseEvent, ZoomConfig, CursorConfig } from '../types';
import type { CursorKeyframe } from '../types/metadata';
import { detectZoomSections, generateSmoothedZoom, type VideoDimensions } from './zoom-tracker';
import { createLogger } from '../utils/logger';
import { SmoothPosition2D, ANIMATION_STYLES } from './smooth-motion';
import { applyCursorMotionBlur } from './motion-blur';
import { easeInOut, easeIn, easeOut } from './effects';
import type { EasingType } from '../types/metadata';
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

  // Prepare cursor overlay (only if visible)
  let cursorBuffer: Buffer | null = null;
  if (frameData.cursorVisible && existsSync(cursorImagePath)) {
    try {
      // Resize cursor to the scaled target size
      let cursorImage = sharp(cursorImagePath)
        .resize(scaledCursorSize, scaledCursorSize, { fit: 'contain', background: TRANSPARENT_BACKGROUND });

      // Get cursor buffer first (before motion blur)
      cursorBuffer = await cursorImage.png().toBuffer();

      // Apply motion blur if enabled (blur is applied relative to cursor speed)
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

  // Calculate cursor overlay position
  // The cursor hotspot is at the top-left of the cursor image (like macOS arrow cursor)
  // Position the image so the hotspot aligns with the cursor coordinates
  const cursorLeft = Math.round(frameData.cursorX);
  const cursorTop = Math.round(frameData.cursorY);

  // Composite cursor overlay
  if (cursorBuffer) {
    // Ensure cursor is within bounds
    const clampedLeft = Math.max(0, Math.min(outputWidth - scaledCursorSize, cursorLeft));
    const clampedTop = Math.max(0, Math.min(outputHeight - scaledCursorSize, cursorTop));

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
 * Uses the same interpolation logic as the preview to ensure timing matches
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

  // Convert frame interval to seconds for physics simulation
  const deltaTime = frameInterval / 1000;

  // Initialize smooth position trackers
  const initialX = cursorKeyframes.length > 0 ? cursorKeyframes[0].x : videoDimensions.width / 2;
  const initialY = cursorKeyframes.length > 0 ? cursorKeyframes[0].y : videoDimensions.height / 2;

  // Determine cursor animation style
  const cursorAnimationStyle = cursorConfig?.animationStyle ?? 'mellow';
  const cursorStyle = ANIMATION_STYLES[cursorAnimationStyle];

  // Cursor smoother with look-ahead to prevent lag
  // We look ahead by the smooth time to ensure the cursor arrives "on time" despite smoothing
  const cursorSmoothTime = cursorStyle.smoothTime;
  const cursorLookAheadMs = cursorSmoothTime * 1000; // Convert to milliseconds

  const cursorSmoother = new SmoothPosition2D(
    initialX,
    initialY,
    cursorSmoothTime
  );

  // Interpolate cursor position function (matching preview logic)
  const interpolateCursor = (timestamp: number): { x: number; y: number } | null => {
    if (cursorKeyframes.length === 0) return null;
    if (cursorKeyframes.length === 1) {
      return { x: cursorKeyframes[0].x, y: cursorKeyframes[0].y };
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
      return { x: prev.x, y: prev.y };
    }

    // Interpolate with easing
    const timeDiff = next.timestamp - prev.timestamp;
    const t = timeDiff > 0 ? (timestamp - prev.timestamp) / timeDiff : 0;

    // Apply easing (matching preview logic exactly)
    const easingType: EasingType = (prev.easing || 'easeInOut') as EasingType;
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
    };
  };

  // Interpolate zoom function using pre-calculated regions
  const interpolateZoom = (timestamp: number): { centerX: number; centerY: number; level: number } | null => {
    if (!zoomConfig?.enabled || zoomRegions.length === 0) {
      return { centerX: videoDimensions.width / 2, centerY: videoDimensions.height / 2, level: 1.0 };
    }

    // Find the region for this timestamp
    // Since zoomRegions are generated per frame, we can map timestamp to index
    // Or use the helper if timestamps don't align perfectly
    const frameIndex = Math.floor(timestamp / frameInterval);
    if (frameIndex >= 0 && frameIndex < zoomRegions.length) {
      const region = zoomRegions[frameIndex];
      return { centerX: region.centerX, centerY: region.centerY, level: region.scale };
    }

    return { centerX: videoDimensions.width / 2, centerY: videoDimensions.height / 2, level: 1.0 };
  };

  // Previous positions for velocity calculation
  let prevSmoothedCursorX = initialX;
  let prevSmoothedCursorY = initialY;
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
    if (cursorKeyframes.length > 1) {
      logger.debug(`Last keyframe: timestamp=${cursorKeyframes[cursorKeyframes.length - 1].timestamp}, x=${cursorKeyframes[cursorKeyframes.length - 1].x}, y=${cursorKeyframes[cursorKeyframes.length - 1].y}`);
    }
  }

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // Calculate timestamp, clamping to videoDuration
    const timestamp = Math.min(frameIndex * frameInterval, videoDuration);

    // ========================================
    // CURSOR MOVEMENT WITH SMOOTHING
    // ========================================
    // Use look-ahead smoothing to ensure cursor arrives on time

    // 1. Calculate look-ahead target
    const lookAheadTimestamp = Math.min(timestamp + cursorLookAheadMs, videoDuration);

    // Get cursor position from keyframes (with look-ahead)
    // Keyframes are stored in video coordinate space (0 to videoWidth, 0 to videoHeight)
    const targetCursorPos = interpolateCursor(lookAheadTimestamp);
    if (!targetCursorPos) continue;

    // Ensure target cursor position is within video bounds
    let targetCursorX = Math.max(0, Math.min(videoDimensions.width, targetCursorPos.x));
    let targetCursorY = Math.max(0, Math.min(videoDimensions.height, targetCursorPos.y));

    // 2. Update smoother
    cursorSmoother.setTarget(targetCursorX, targetCursorY);
    const smoothedPos = cursorSmoother.update(deltaTime);

    // 3. Use smoothed position
    const smoothedCursor = { x: smoothedPos.x, y: smoothedPos.y };

    // Ensure smoothed position is within video bounds
    const clampedX = Math.max(0, Math.min(videoDimensions.width, smoothedCursor.x));
    const clampedY = Math.max(0, Math.min(videoDimensions.height, smoothedCursor.y));

    if (frameIndex < 5) {
      logger.debug(`Frame ${frameIndex}: timestamp=${timestamp}, targetPos=(${targetCursorX}, ${targetCursorY}), smoothedPos=(${clampedX}, ${clampedY}), videoDims=(${videoDimensions.width}, ${videoDimensions.height})`);
    }

    // Calculate velocity for motion blur (using smoothed position)
    const velocityX = (clampedX - prevSmoothedCursorX) / deltaTime;
    const velocityY = (clampedY - prevSmoothedCursorY) / deltaTime;

    // Check if cursor is moving (for hide when static)
    const movementDistance = Math.sqrt(
      Math.pow(clampedX - prevSmoothedCursorX, 2) +
      Math.pow(clampedY - prevSmoothedCursorY, 2)
    );

    if (movementDistance > staticThreshold) {
      lastMovementTime = timestamp;
    }

    prevSmoothedCursorX = clampedX;
    prevSmoothedCursorY = clampedY;

    // Determine cursor visibility
    let cursorVisible = true;
    if (cursorConfig?.hideWhenStatic) {
      cursorVisible = (timestamp - lastMovementTime) < hideAfterMs;
    }

    // Calculate click animation scale
    const clickAnimationScale = clicks ? calculateClickAnimationScale(timestamp, clicks) : 1.0;

    // Get zoom data
    const zoomData = interpolateZoom(timestamp);

    if (zoomConfig?.enabled && zoomData) {
      // Calculate zoom velocity
      const zoomVelocityX = (zoomData.centerX - prevZoomCenterX) / deltaTime;
      const zoomVelocityY = (zoomData.centerY - prevZoomCenterY) / deltaTime;
      prevZoomCenterX = zoomData.centerX;
      prevZoomCenterY = zoomData.centerY;

      frameDataList.push({
        frameIndex,
        timestamp,
        cursorX: clampedX,
        cursorY: clampedY,
        cursorVisible,
        cursorVelocityX: velocityX,
        cursorVelocityY: velocityY,
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
        cursorX: clampedX,
        cursorY: clampedY,
        cursorVisible,
        cursorVelocityX: velocityX,
        cursorVelocityY: velocityY,
        clickAnimationScale,
      });
    }
  }

  return frameDataList;
}

/**
 * Create frame data from mouse events with professional-quality smooth motion
 * Uses spring physics and momentum for Screen Studio-like smoothness
 */
export function createFrameDataFromEvents(
  events: MouseEvent[],
  frameRate: number,
  videoDuration: number,
  videoDimensions: { width: number; height: number },
  screenDimensions: { width: number; height: number },
  cursorConfig?: CursorConfig,
  zoomConfig?: ZoomConfig,
  clicks?: Array<{ timestamp: number; action: string }>
): FrameData[] {
  const frameInterval = 1000 / frameRate;
  const totalFrames = Math.ceil(videoDuration / frameInterval);
  const frameDataList: FrameData[] = [];

  // Scale factors for Retina displays
  const scaleX = videoDimensions.width / screenDimensions.width;
  const scaleY = videoDimensions.height / screenDimensions.height;

  // Convert frame interval to seconds for physics simulation
  const deltaTime = frameInterval / 1000;

  // Initialize smooth position trackers
  const initialX = events.length > 0 ? events[0].x * scaleX : videoDimensions.width / 2;
  const initialY = events.length > 0 ? events[0].y * scaleY : videoDimensions.height / 2;
  const finalX = events.length > 0 ? events[events.length - 1].x * scaleX : initialX;
  const finalY = events.length > 0 ? events[events.length - 1].y * scaleY : initialY;

  // Determine cursor animation style
  const cursorAnimationStyle = cursorConfig?.animationStyle ?? 'mellow';
  const cursorStyle = ANIMATION_STYLES[cursorAnimationStyle];

  // Cursor smoother with look-ahead to prevent lag
  // We look ahead by the smooth time to ensure the cursor arrives "on time" despite smoothing
  // This compensates for the smoothing delay by targeting future positions
  const cursorSmoothTime = cursorStyle.smoothTime;
  const cursorLookAheadFrames = Math.ceil(cursorSmoothTime * frameRate);

  // Ensure look-ahead doesn't exceed available events (safety check)
  // The look-ahead frames calculation ensures we target positions that will be reached
  // at the right time despite the smoothing delay

  const cursorSmoother = new SmoothPosition2D(
    initialX,
    initialY,
    cursorSmoothTime
  );

  // Previous cursor position for velocity calculation
  let prevSmoothedCursorX = initialX;
  let prevSmoothedCursorY = initialY;
  let prevZoomCenterX = videoDimensions.width / 2;
  let prevZoomCenterY = videoDimensions.height / 2;

  // Pre-calculate zoom regions if enabled
  let zoomRegions: import('./zoom-tracker').ZoomRegion[] = [];
  if (zoomConfig?.enabled) {
    const scaledEvents = events.map(e => ({
      ...e,
      x: e.x * scaleX,
      y: e.y * scaleY
    }));
    const zoomSections = detectZoomSections(
      scaledEvents,
      videoDimensions,
      zoomConfig
    );
    zoomRegions = generateSmoothedZoom(
      zoomSections,
      videoDimensions,
      zoomConfig,
      frameRate,
      videoDuration
    );
  }

  // Track cursor movement for "hide when static" feature
  const staticThreshold = CURSOR_STATIC_THRESHOLD; // pixels - cursor is considered static if movement < this
  let lastMovementTime = 0;
  const hideAfterMs = CURSOR_HIDE_AFTER_MS; // Hide cursor after configured milliseconds of no movement

  // Loop position: return cursor to initial position at end
  const loopPosition = cursorConfig?.loopPosition ?? false;
  const loopStartFrame = loopPosition ? Math.max(0, totalFrames - Math.floor(frameRate * CURSOR_LOOP_DURATION_SECONDS)) : totalFrames;



  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // Calculate timestamp, clamping to videoDuration to avoid floating-point precision issues
    const timestamp = Math.min(frameIndex * frameInterval, videoDuration);

    // ========================================
    // CURSOR MOVEMENT
    // ========================================
    // Use look-ahead smoothing to ensure cursor arrives on time

    // 1. Calculate look-ahead target
    let targetIndex = frameIndex + cursorLookAheadFrames;
    if (targetIndex >= events.length) {
      targetIndex = events.length - 1;
    }
    if (targetIndex < 0) {
      targetIndex = 0;
    }

    let targetCursorX = initialX;
    let targetCursorY = initialY;

    if (events.length > 0) {
      const targetEvent = events[targetIndex];
      targetCursorX = targetEvent.x * scaleX;
      targetCursorY = targetEvent.y * scaleY;
    }

    // Handle loop position - return to initial position at end
    if (loopPosition && frameIndex >= loopStartFrame) {
      const loopProgress = (frameIndex - loopStartFrame) / (totalFrames - loopStartFrame);
      const loopEase = loopProgress * loopProgress;
      targetCursorX = targetCursorX + (initialX - targetCursorX) * loopEase;
      targetCursorY = targetCursorY + (initialY - targetCursorY) * loopEase;
    }

    // 2. Update smoother
    cursorSmoother.setTarget(targetCursorX, targetCursorY);
    const smoothedPos = cursorSmoother.update(deltaTime);

    // 3. Use smoothed position
    const smoothedCursor = { x: smoothedPos.x, y: smoothedPos.y };

    // Calculate cursor velocity for motion blur
    const velocityX = (smoothedCursor.x - prevSmoothedCursorX) / deltaTime;
    const velocityY = (smoothedCursor.y - prevSmoothedCursorY) / deltaTime;

    // Check if cursor is moving (for hide when static)
    const movementDistance = Math.sqrt(
      Math.pow(smoothedCursor.x - prevSmoothedCursorX, 2) +
      Math.pow(smoothedCursor.y - prevSmoothedCursorY, 2)
    );

    if (movementDistance > staticThreshold) {
      lastMovementTime = timestamp;
    }

    prevSmoothedCursorX = smoothedCursor.x;
    prevSmoothedCursorY = smoothedCursor.y;

    // Determine cursor visibility
    // By default, cursor is always visible (overlaid from tracking data)
    // Only hide if hideWhenStatic is explicitly enabled AND cursor hasn't moved recently
    let cursorVisible = true; // Default: always show cursor overlay
    if (cursorConfig?.hideWhenStatic) {
      // Only hide if cursor hasn't moved in the last hideAfterMs milliseconds
      cursorVisible = (timestamp - lastMovementTime) < hideAfterMs;
    }

    // Calculate click animation scale
    const clickAnimationScale = clicks ? calculateClickAnimationScale(timestamp, clicks) : 1.0;

    // Get zoom data from pre-calculated regions
    let zoomCenterX = smoothedCursor.x;
    let zoomCenterY = smoothedCursor.y;
    let zoomLevel = 1.0;

    if (zoomConfig?.enabled && frameIndex < zoomRegions.length) {
      const region = zoomRegions[frameIndex];
      zoomCenterX = region.centerX;
      zoomCenterY = region.centerY;
      zoomLevel = region.scale;
    }
    // Calculate zoom velocity for motion blur
    let zoomVelocityX = 0;
    let zoomVelocityY = 0;

    if (zoomConfig?.enabled) {
      zoomVelocityX = (zoomCenterX - prevZoomCenterX) / deltaTime;
      zoomVelocityY = (zoomCenterY - prevZoomCenterY) / deltaTime;
      prevZoomCenterX = zoomCenterX;
      prevZoomCenterY = zoomCenterY;

      frameDataList.push({
        frameIndex,
        timestamp,
        cursorX: smoothedCursor.x,
        cursorY: smoothedCursor.y,
        cursorVisible,
        cursorVelocityX: velocityX,
        cursorVelocityY: velocityY,
        clickAnimationScale,
        zoomCenterX,
        zoomCenterY,
        zoomLevel,
        zoomVelocityX,
        zoomVelocityY,
      });
    } else {
      frameDataList.push({
        frameIndex,
        timestamp,
        cursorX: smoothedCursor.x,
        cursorY: smoothedCursor.y,
        cursorVisible,
        cursorVelocityX: velocityX,
        cursorVelocityY: velocityY,
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
