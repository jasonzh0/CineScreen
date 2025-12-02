import sharp from 'sharp';
import { createLogger } from '../utils/logger';
import {
  MOTION_BLUR_VELOCITY_THRESHOLD,
  MOTION_BLUR_BASE_MULTIPLIER,
  MOTION_BLUR_MAX_LENGTH,
  MOTION_BLUR_MIN_LENGTH,
  MOTION_BLUR_SIGMA_FACTOR,
} from '../utils/constants';

const logger = createLogger('MotionBlur');

/**
 * Apply motion blur to an image based on velocity
 * This simulates the cinematic motion blur effect
 */
export async function applyMotionBlur(
  imageBuffer: Buffer,
  velocityX: number,
  velocityY: number,
  strength: number, // 0-1
  frameRate: number
): Promise<Buffer> {
  if (strength <= 0 || (Math.abs(velocityX) < MOTION_BLUR_VELOCITY_THRESHOLD && Math.abs(velocityY) < MOTION_BLUR_VELOCITY_THRESHOLD)) {
    // No blur needed
    return imageBuffer;
  }

  // Calculate blur angle and length based on velocity
  const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
  const angle = Math.atan2(velocityY, velocityX) * (180 / Math.PI);
  
  // Blur length is proportional to speed and strength
  // Scale by frame rate to normalize across different frame rates
  const baseBlurLength = (speed / frameRate) * strength * MOTION_BLUR_BASE_MULTIPLIER;
  const blurLength = Math.min(baseBlurLength, MOTION_BLUR_MAX_LENGTH);

  if (blurLength < MOTION_BLUR_MIN_LENGTH) {
    // Too small to be noticeable
    return imageBuffer;
  }

  try {
    // Use Sharp's motion blur (if available) or directional blur
    // Sharp doesn't have native motion blur, so we'll use a combination of
    // gaussian blur and directional effects
    
    // For now, we'll use a simple gaussian blur as approximation
    // In production, you'd want to use a proper motion blur filter
    const sigma = blurLength * MOTION_BLUR_SIGMA_FACTOR; // Convert blur length to sigma
    
    const blurred = await sharp(imageBuffer)
      .blur(sigma)
      .toBuffer();
    
    return blurred;
  } catch (error) {
    logger.warn('Failed to apply motion blur, returning original:', error);
    return imageBuffer;
  }
}

/**
 * Apply motion blur to cursor based on movement velocity
 */
export async function applyCursorMotionBlur(
  cursorBuffer: Buffer,
  velocityX: number,
  velocityY: number,
  strength: number,
  frameRate: number
): Promise<Buffer> {
  return applyMotionBlur(cursorBuffer, velocityX, velocityY, strength, frameRate);
}

/**
 * Calculate velocity between two positions
 */
export function calculateVelocity(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  timeDelta: number
): { x: number; y: number; speed: number } {
  if (timeDelta <= 0) {
    return { x: 0, y: 0, speed: 0 };
  }

  const velocityX = (x2 - x1) / timeDelta;
  const velocityY = (y2 - y1) / timeDelta;
  const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);

  return { x: velocityX, y: velocityY, speed };
}

