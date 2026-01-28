import sharp from 'sharp';
import { createLogger } from '../utils/logger';
import {
  MOTION_BLUR_VELOCITY_THRESHOLD,
  MOTION_BLUR_BASE_MULTIPLIER,
  MOTION_BLUR_MAX_LENGTH,
  MOTION_BLUR_MIN_LENGTH,
} from '../utils/constants';

const logger = createLogger('MotionBlur');

/**
 * Create a directional motion blur kernel
 * The kernel is a line of values along the direction of motion
 */
function createMotionBlurKernel(
  angle: number,
  length: number
): { width: number; height: number; kernel: number[] } {
  // Kernel size must be odd and at least 3
  const kernelSize = Math.max(3, Math.ceil(length) | 1); // Ensure odd
  const center = Math.floor(kernelSize / 2);

  // Create empty kernel
  const kernel: number[] = new Array(kernelSize * kernelSize).fill(0);

  // Calculate direction vector
  const angleRad = (angle * Math.PI) / 180;
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);

  // Draw a line through the kernel center in the direction of motion
  let totalWeight = 0;
  for (let i = -center; i <= center; i++) {
    const x = Math.round(center + i * dx);
    const y = Math.round(center + i * dy);

    if (x >= 0 && x < kernelSize && y >= 0 && y < kernelSize) {
      const idx = y * kernelSize + x;
      // Use gaussian-weighted samples for smoother blur
      const weight = Math.exp(-(i * i) / (length * length * 0.5));
      kernel[idx] += weight;
      totalWeight += weight;
    }
  }

  // Normalize kernel so it sums to 1
  if (totalWeight > 0) {
    for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= totalWeight;
    }
  }

  return { width: kernelSize, height: kernelSize, kernel };
}

/**
 * Apply motion blur to an image based on velocity
 * This simulates the cinematic motion blur effect using directional convolution
 */
async function applyMotionBlur(
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
    // Create directional motion blur kernel
    const { width, height, kernel } = createMotionBlurKernel(angle, blurLength);

    // Apply convolution with the motion blur kernel
    const blurred = await sharp(imageBuffer)
      .convolve({
        width,
        height,
        kernel,
      })
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
function calculateVelocity(
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

