import sharp from 'sharp';
import { existsSync, readFileSync } from 'fs';
import type { MouseEvent, ZoomConfig, CursorConfig } from '../types';
import type { CursorKeyframe, ZoomKeyframe } from '../types/metadata';
import { createLogger } from '../utils/logger';
import { SmoothPosition2D, SmoothValue, applyDeadZone, getAdaptiveSmoothTime, ANIMATION_STYLES } from './smooth-motion';
import { applyCursorMotionBlur, calculateVelocity } from './motion-blur';
import { easeInOut, easeIn, easeOut } from './effects';
import type { EasingType } from '../types/metadata';
import {
  BLACK_BACKGROUND,
  TRANSPARENT_BACKGROUND,
  PNG_QUALITY,
  PNG_COMPRESSION_LEVEL,
  SVG_DENSITY,
  CURSOR_GLIDE_START_FRAMES,
  CURSOR_STATIC_THRESHOLD,
  CURSOR_HIDE_AFTER_MS,
  CURSOR_LOOP_DURATION_SECONDS,
  DEFAULT_ZOOM_DEAD_ZONE,
  ZOOM_FOCUS_REQUIRED_MS,
  ZOOM_FOCUS_THRESHOLD,
  ZOOM_FOCUS_AREA_RADIUS,
  ZOOM_TRANSITION_SPEED,
  ZOOM_OUT_SPEED_MULTIPLIER,
  ZOOM_VELOCITY_THRESHOLD,
  MOTION_BLUR_MIN_VELOCITY,
  MOTION_BLUR_MAX_SIGMA,
  MOTION_BLUR_STRENGTH_MULTIPLIER,
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

  // Calculate aspect-ratio preserving scale (matching preview logic)
  const scaleX = outputWidth / currentFrameWidth;
  const scaleY = outputHeight / currentFrameHeight;
  const scale = Math.min(scaleX, scaleY);

  // Calculate actual display dimensions after aspect-ratio preserving scaling
  const actualDisplayWidth = currentFrameWidth * scale;
  const actualDisplayHeight = currentFrameHeight * scale;

  // Calculate offsets for letterboxing/pillarboxing (Sharp's 'contain' centers automatically)
  offsetX = (outputWidth - actualDisplayWidth) / 2;
  offsetY = (outputHeight - actualDisplayHeight) / 2;

  // Resize with aspect ratio preservation (using 'contain' fit)
  // Sharp will automatically preserve aspect ratio, add background, and center the image
  pipeline = pipeline.resize(outputWidth, outputHeight, {
    fit: 'contain',
    kernel: 'lanczos3',
    background: BLACK_BACKGROUND, // Black background for letterboxing
  });

  // Scale cursor position using the same scale factor and offsets as the preview
  frameData.cursorX = Math.round(frameData.cursorX * scale + offsetX);
  frameData.cursorY = Math.round(frameData.cursorY * scale + offsetY);

  // Scale cursor size to match the video scale (matching preview logic)
  const scaledCursorSize = Math.round(cursorSize * scale);

  // Prepare cursor overlay (only if visible)
  let cursorBuffer: Buffer | null = null;
  if (frameData.cursorVisible && existsSync(cursorImagePath)) {
    try {
      // Resize cursor to the scaled target size
      let cursorImage = sharp(cursorImagePath)
        .resize(scaledCursorSize, scaledCursorSize, { fit: 'contain', background: TRANSPARENT_BACKGROUND });

      // Apply motion blur if enabled
      if (options.cursorConfig?.motionBlur?.enabled) {
        const motionBlurStrength = options.cursorConfig.motionBlur.strength ?? 0.5;
        const velocity = calculateVelocity(
          0, 0,
          frameData.cursorVelocityX,
          frameData.cursorVelocityY,
          1 / options.frameRate
        );
        
        // Note: Sharp doesn't have native motion blur, so we'll apply it as a post-process
        // For now, we'll use a simple blur approximation
        if (velocity.speed > MOTION_BLUR_MIN_VELOCITY) { // Only blur if moving fast enough
          const blurSigma = velocity.speed * motionBlurStrength * MOTION_BLUR_STRENGTH_MULTIPLIER;
          cursorImage = cursorImage.blur(Math.min(blurSigma, MOTION_BLUR_MAX_SIGMA));
        }
      }

      cursorBuffer = await cursorImage.png().toBuffer();
    } catch (error) {
      logger.warn('Failed to load cursor image:', error);
    }
  }

  // Calculate cursor overlay position
  // Position is the top-left corner of the cursor image (centered on cursor point)
  // Subtract half cursor size to center the cursor on the position
  const cursorLeft = Math.round(frameData.cursorX - scaledCursorSize / 2);
  const cursorTop = Math.round(frameData.cursorY - scaledCursorSize / 2);

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
 * Create frame data directly from cursor keyframes (for metadata-based export)
 * Uses the same interpolation logic as the preview to ensure timing matches
 */
export function createFrameDataFromKeyframes(
  cursorKeyframes: CursorKeyframe[],
  zoomKeyframes: ZoomKeyframe[],
  frameRate: number,
  videoDuration: number,
  videoDimensions: { width: number; height: number },
  cursorConfig?: CursorConfig,
  zoomConfig?: ZoomConfig
): FrameData[] {
  const frameInterval = 1000 / frameRate;
  const totalFrames = Math.ceil(videoDuration / frameInterval);
  const frameDataList: FrameData[] = [];

  // Convert frame interval to seconds for velocity calculation
  const deltaTime = frameInterval / 1000;

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

  // Interpolate zoom function
  const interpolateZoom = (timestamp: number): { centerX: number; centerY: number; level: number } | null => {
    if (!zoomConfig?.enabled || zoomKeyframes.length === 0) {
      return { centerX: videoDimensions.width / 2, centerY: videoDimensions.height / 2, level: 1.0 };
    }
    if (zoomKeyframes.length === 1) {
      const kf = zoomKeyframes[0];
      return { centerX: kf.centerX, centerY: kf.centerY, level: kf.level };
    }

    // Find bracketing keyframes
    let prev: typeof zoomKeyframes[0] | null = null;
    let next: typeof zoomKeyframes[0] | null = null;

    for (let i = 0; i < zoomKeyframes.length; i++) {
      if (zoomKeyframes[i].timestamp <= timestamp) {
        prev = zoomKeyframes[i];
        next = zoomKeyframes[i + 1] || zoomKeyframes[i];
      } else {
        if (!prev) {
          prev = zoomKeyframes[0];
          next = zoomKeyframes[0];
        } else {
          next = zoomKeyframes[i];
        }
        break;
      }
    }

    if (!prev || !next) return null;
    if (prev.timestamp === next.timestamp) {
      return { centerX: prev.centerX, centerY: prev.centerY, level: prev.level };
    }

    // Interpolate with easing
    const timeDiff = next.timestamp - prev.timestamp;
    const t = timeDiff > 0 ? (timestamp - prev.timestamp) / timeDiff : 0;
    
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
      centerX: prev.centerX + (next.centerX - prev.centerX) * easedT,
      centerY: prev.centerY + (next.centerY - prev.centerY) * easedT,
      level: prev.level + (next.level - prev.level) * easedT,
    };
  };

  // Previous positions for velocity calculation
  let prevCursorX = videoDimensions.width / 2;
  let prevCursorY = videoDimensions.height / 2;
  let prevZoomCenterX = videoDimensions.width / 2;
  let prevZoomCenterY = videoDimensions.height / 2;
  let prevSmoothedCursorX = videoDimensions.width / 2;
  let prevSmoothedCursorY = videoDimensions.height / 2;

  // Track cursor movement for "hide when static"
  const staticThreshold = CURSOR_STATIC_THRESHOLD;
  let lastMovementTime = 0;
  const hideAfterMs = CURSOR_HIDE_AFTER_MS;

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // Calculate timestamp, clamping to videoDuration
    const timestamp = Math.min(frameIndex * frameInterval, videoDuration);

    // Get cursor position from keyframes
    const cursorPos = interpolateCursor(timestamp);
    if (!cursorPos) continue;

    // Calculate velocity for motion blur
    const velocityX = (cursorPos.x - prevCursorX) / deltaTime;
    const velocityY = (cursorPos.y - prevCursorY) / deltaTime;
    prevCursorX = cursorPos.x;
    prevCursorY = cursorPos.y;

    // Check if cursor is moving (for hide when static)
    const movementDistance = Math.sqrt(
      Math.pow(cursorPos.x - prevSmoothedCursorX, 2) +
      Math.pow(cursorPos.y - prevSmoothedCursorY, 2)
    );
    
    if (movementDistance > staticThreshold) {
      lastMovementTime = timestamp;
    }
    
    prevSmoothedCursorX = cursorPos.x;
    prevSmoothedCursorY = cursorPos.y;

    // Determine cursor visibility
    let cursorVisible = true;
    if (cursorConfig?.hideWhenStatic) {
      cursorVisible = (timestamp - lastMovementTime) < hideAfterMs;
    }

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
        cursorX: cursorPos.x,
        cursorY: cursorPos.y,
        cursorVisible,
        cursorVelocityX: velocityX,
        cursorVelocityY: velocityY,
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
        cursorX: cursorPos.x,
        cursorY: cursorPos.y,
        cursorVisible,
        cursorVelocityX: velocityX,
        cursorVelocityY: velocityY,
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
  zoomConfig?: ZoomConfig
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

  // Determine cursor animation style for glide transitions
  const cursorAnimationStyle = cursorConfig?.animationStyle ?? 'mellow';
  const glideStyle = ANIMATION_STYLES[cursorAnimationStyle];
  
  // Start gliding frames before the click
  const glideStartFrames = CURSOR_GLIDE_START_FRAMES;
  const glideStartMs = (glideStartFrames / frameRate) * 1000; // Convert frames to milliseconds

  // Determine zoom animation style (prefer animationStyle over legacy smoothness)
  const zoomAnimationStyle = zoomConfig?.animationStyle ?? 
    (zoomConfig?.smoothness === 'cinematic' ? 'slow' :
     zoomConfig?.smoothness === 'snappy' ? 'quick' : 'mellow');
  const zoomStyle = ANIMATION_STYLES[zoomAnimationStyle];
  const baseSmoothTime = zoomStyle.smoothTime;

  // Zoom center smoother (Screen Studio-like cinematic following)
  const zoomCenterSmoother = new SmoothPosition2D(
    videoDimensions.width / 2,
    videoDimensions.height / 2,
    baseSmoothTime
  );

  // Dead zone radius - prevents jitter when cursor is nearly stationary
  const deadZoneRadius = (zoomConfig?.deadZone ?? DEFAULT_ZOOM_DEAD_ZONE) * scaleX; // Scale with video

  // Previous cursor position for velocity calculation
  let prevCursorX = initialX;
  let prevCursorY = initialY;
  let prevSmoothedCursorX = initialX;
  let prevSmoothedCursorY = initialY;
  let prevZoomCenterX = videoDimensions.width / 2;
  let prevZoomCenterY = videoDimensions.height / 2;

  // Track cursor movement for "hide when static" feature
  const staticThreshold = CURSOR_STATIC_THRESHOLD; // pixels - cursor is considered static if movement < this
  let lastMovementTime = 0;
  const hideAfterMs = CURSOR_HIDE_AFTER_MS; // Hide cursor after configured milliseconds of no movement

  // Loop position: return cursor to initial position at end
  const loopPosition = cursorConfig?.loopPosition ?? false;
  const loopStartFrame = loopPosition ? Math.max(0, totalFrames - Math.floor(frameRate * CURSOR_LOOP_DURATION_SECONDS)) : totalFrames;

  // ========================================
  // CLICK-TO-CLICK CURSOR GLIDE
  // ========================================
  // Cursor glides smoothly between click positions
  // Between clicks, cursor stays at the last click position (doesn't follow movement)
  const clickEvents = events.filter(e => e.action === 'down');
  
  // Build cursor path: only click positions + initial position
  const cursorPositions: Array<{ timestamp: number; x: number; y: number }> = [];
  
  // Always start at initial position
  cursorPositions.push({ timestamp: 0, x: initialX, y: initialY });
  
  // Add all click positions
  for (const click of clickEvents) {
    cursorPositions.push({
      timestamp: click.timestamp,
      x: click.x * scaleX,
      y: click.y * scaleY,
    });
  }
  
  // If there are clicks, add a final position at the end to keep cursor visible
  if (clickEvents.length > 0) {
    const lastClick = clickEvents[clickEvents.length - 1];
    cursorPositions.push({
      timestamp: videoDuration,
      x: lastClick.x * scaleX,
      y: lastClick.y * scaleY,
    });
  } else {
    // No clicks - cursor stays at initial position
    cursorPositions.push({
      timestamp: videoDuration,
      x: initialX,
      y: initialY,
    });
  }
  
  // ========================================
  // SMART AUTO-ZOOM: Focus Detection
  // ========================================
  // Only zoom if user focuses on an area for configured duration
  // Otherwise, don't zoom at all
  const focusRequiredMs = ZOOM_FOCUS_REQUIRED_MS; // Must focus for configured duration before zoom activates
  const focusThreshold = ZOOM_FOCUS_THRESHOLD * scaleX; // Max movement to be considered "focused"
  const focusAreaRadius = ZOOM_FOCUS_AREA_RADIUS * scaleX; // Must stay within this radius to maintain focus
  
  let focusStartTime: number | null = null; // When focus started
  let focusAnchorX = initialX; // The position where focus started
  let focusAnchorY = initialY;
  let currentZoomLevel = 1.0; // Smoothly interpolate zoom level
  const zoomTransitionSpeed = ZOOM_TRANSITION_SPEED; // How fast to transition zoom (slower for smoother effect)

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // Calculate timestamp, clamping to videoDuration to avoid floating-point precision issues
    const timestamp = Math.min(frameIndex * frameInterval, videoDuration);

    // ========================================
    // CLICK-TO-CLICK GLIDE: Only move between click positions
    // ========================================
    // Find which click positions we're between
    let prevClick = cursorPositions[0];
    let nextClick = cursorPositions[cursorPositions.length - 1];
    
    // Find the segment we're in
    for (let i = 0; i < cursorPositions.length - 1; i++) {
      if (timestamp >= cursorPositions[i].timestamp && timestamp < cursorPositions[i + 1].timestamp) {
        prevClick = cursorPositions[i];
        nextClick = cursorPositions[i + 1];
        break;
      }
    }
    
    // If we're at or past the last position, use it
    if (timestamp >= cursorPositions[cursorPositions.length - 1].timestamp) {
      prevClick = cursorPositions[cursorPositions.length - 1];
      nextClick = cursorPositions[cursorPositions.length - 1];
    }
    
    // Calculate glide progress between clicks
    const timeBetweenClicks = nextClick.timestamp - prevClick.timestamp;
    const timeSincePrevClick = timestamp - prevClick.timestamp;
    const timeUntilNextClick = nextClick.timestamp - timestamp;
    
    let targetCursorX = prevClick.x;
    let targetCursorY = prevClick.y;
    
    // If there's a next click, glide towards it starting 7 frames before
    if (timeBetweenClicks > 0 && prevClick !== nextClick) {
      // Check if we should start gliding (7 frames before the click)
      if (timeUntilNextClick <= glideStartMs && timeUntilNextClick >= 0) {
        // We're within the glide window - calculate glide progress
        const glideProgress = 1 - (timeUntilNextClick / glideStartMs);
        
        // Smooth ease-in-out curve for natural glide
        const easeInOut = glideProgress < 0.5 
          ? 2 * glideProgress * glideProgress 
          : 1 - Math.pow(-2 * glideProgress + 2, 2) / 2;
        
        // Glide from previous click position to next click position
        targetCursorX = prevClick.x + (nextClick.x - prevClick.x) * easeInOut;
        targetCursorY = prevClick.y + (nextClick.y - prevClick.y) * easeInOut;
      } else if (timeUntilNextClick < 0) {
        // We've reached or passed the next click - stay at it
        targetCursorX = nextClick.x;
        targetCursorY = nextClick.y;
      } else {
        // We're before the glide window - stay at previous click position
        targetCursorX = prevClick.x;
        targetCursorY = prevClick.y;
      }
    } else {
      // No time between clicks or at same position - use current position
      targetCursorX = prevClick.x;
      targetCursorY = prevClick.y;
    }
    
    // Handle loop position - return to initial position at end
    if (loopPosition && frameIndex >= loopStartFrame) {
      const loopProgress = (frameIndex - loopStartFrame) / (totalFrames - loopStartFrame);
      const loopEase = loopProgress * loopProgress;
      targetCursorX = targetCursorX + (initialX - targetCursorX) * loopEase;
      targetCursorY = targetCursorY + (initialY - targetCursorY) * loopEase;
    }

    // Calculate cursor velocity for motion blur
    const velocityX = (targetCursorX - prevCursorX) / deltaTime;
    const velocityY = (targetCursorY - prevCursorY) / deltaTime;
    prevCursorX = targetCursorX;
    prevCursorY = targetCursorY;

    // Check if cursor is moving (for hide when static)
    const movementDistance = Math.sqrt(
      Math.pow(targetCursorX - prevSmoothedCursorX, 2) +
      Math.pow(targetCursorY - prevSmoothedCursorY, 2)
    );
    
    if (movementDistance > staticThreshold) {
      lastMovementTime = timestamp;
    }

    // Use target position directly (no additional smoothing - glide handles it)
    const smoothedCursor = { x: targetCursorX, y: targetCursorY };
    
    // Calculate velocity for motion blur
    const smoothedVelocityX = velocityX;
    const smoothedVelocityY = velocityY;
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

    // ========================================
    // SMART AUTO-ZOOM: 2-Second Focus Detection
    // ========================================
    // Check if cursor is within focus area
    const distanceFromAnchor = Math.sqrt(
      Math.pow(smoothedCursor.x - focusAnchorX, 2) +
      Math.pow(smoothedCursor.y - focusAnchorY, 2)
    );
    
    // Check if cursor has moved too much (breaking focus)
    const isWithinFocusArea = distanceFromAnchor < focusAreaRadius;
    
    if (isWithinFocusArea) {
      // Cursor is staying in one area
      if (focusStartTime === null) {
        // Start tracking focus
        focusStartTime = timestamp;
        focusAnchorX = smoothedCursor.x;
        focusAnchorY = smoothedCursor.y;
      }
    } else {
      // Cursor moved too far - reset focus tracking
      focusStartTime = null;
      focusAnchorX = smoothedCursor.x;
      focusAnchorY = smoothedCursor.y;
    }
    
    // Calculate how long user has been focused
    const focusDuration = focusStartTime !== null ? timestamp - focusStartTime : 0;
    const isFocused = focusDuration >= focusRequiredMs; // Only true after 2 seconds

    // Initialize zoom values
    let zoomCenterX = smoothedCursor.x;
    let zoomCenterY = smoothedCursor.y;
    let zoomLevel = 1.0;

    if (zoomConfig?.enabled) {
      // Target zoom level: only zoom if focused for 2+ seconds
      const targetZoomLevel = isFocused ? zoomConfig.level : 1.0;
      
      // Smoothly transition zoom level (auto-zoom only when focused)
      if (zoomConfig?.autoZoom !== false) {
        // Gradual zoom in/out
        if (targetZoomLevel > currentZoomLevel) {
          currentZoomLevel = Math.min(targetZoomLevel, currentZoomLevel + zoomTransitionSpeed);
        } else if (targetZoomLevel < currentZoomLevel) {
          currentZoomLevel = Math.max(targetZoomLevel, currentZoomLevel - zoomTransitionSpeed * ZOOM_OUT_SPEED_MULTIPLIER); // Zoom out faster
        }
      } else {
        // Auto-zoom disabled, always use configured level
        currentZoomLevel = zoomConfig.level;
      }
      
      zoomLevel = currentZoomLevel;

      // Apply dead zone to prevent micro-movements
      const targetWithDeadZone = applyDeadZone(
        zoomCenterSmoother.getPosition(),
        { x: smoothedCursor.x, y: smoothedCursor.y },
        deadZoneRadius
      );

      // Adaptive smooth time based on cursor velocity
      // Fast movements = quicker following, slow movements = more cinematic
      const minSmoothTime = zoomStyle.minSmoothTime;

      const adaptiveSmoothTime = getAdaptiveSmoothTime(
        velocityX,
        velocityY,
        baseSmoothTime,
        minSmoothTime,
        ZOOM_VELOCITY_THRESHOLD   // Velocity threshold (pixels per second)
      );

      // Create a temporary smoother with adaptive timing
      // This is a simplified approach - in production you'd modify the smoother's internal time
      const followStrength = baseSmoothTime / adaptiveSmoothTime;
      
      // Set target and update zoom center with smooth following
      zoomCenterSmoother.setTarget(targetWithDeadZone.x, targetWithDeadZone.y);
      const smoothedZoomCenter = zoomCenterSmoother.update(deltaTime * followStrength);

      zoomCenterX = smoothedZoomCenter.x;
      zoomCenterY = smoothedZoomCenter.y;

      // Clamp zoom center to keep view within bounds
      const halfWidth = (videoDimensions.width / zoomLevel) / 2;
      const halfHeight = (videoDimensions.height / zoomLevel) / 2;
      
      zoomCenterX = Math.max(halfWidth, Math.min(videoDimensions.width - halfWidth, zoomCenterX));
      zoomCenterY = Math.max(halfHeight, Math.min(videoDimensions.height - halfHeight, zoomCenterY));

      // Calculate zoom velocity for motion blur
      const zoomVelocityX = (zoomCenterX - prevZoomCenterX) / deltaTime;
      const zoomVelocityY = (zoomCenterY - prevZoomCenterY) / deltaTime;
      prevZoomCenterX = zoomCenterX;
      prevZoomCenterY = zoomCenterY;

      frameDataList.push({
        frameIndex,
        timestamp,
        cursorX: smoothedCursor.x,
        cursorY: smoothedCursor.y,
        cursorVisible,
        cursorVelocityX: smoothedVelocityX,
        cursorVelocityY: smoothedVelocityY,
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
        cursorVelocityX: smoothedVelocityX,
        cursorVelocityY: smoothedVelocityY,
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
