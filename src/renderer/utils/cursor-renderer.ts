import type { RecordingMetadata, CursorKeyframe, EasingType } from '../../types/metadata';
import { easeInOut, easeIn, easeOut } from '../../processing/effects';
import { 
  CURSOR_CLICK_ANIMATION_DURATION_MS,
  CURSOR_CLICK_ANIMATION_SCALE
} from '../../utils/constants';

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
  // Use easing from start keyframe, or default to easeInOut
  const easingType: EasingType = prevKeyframe.easing || 'easeInOut';
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

  // Get cursor position at timestamp
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

  // Scale cursor position to display coordinates with offset
  const x = cursorPos.x * scale + offsetX;
  const y = cursorPos.y * scale + offsetY;

  // Get cursor config
  const config = metadata.cursor.config;
  const size = cursorPos.size || config.size || 60;
  const shape = cursorPos.shape || config.shape || 'arrow';
  const color = cursorPos.color || config.color || '#000000';

  // Calculate click animation scale
  const clickAnimationScale = calculateClickAnimationScale(timestamp, metadata.clicks || []);

  // Scale cursor size (base scale * click animation scale)
  const cursorSize = size * scale * clickAnimationScale;

  // Draw cursor (simplified - in production you'd load the actual cursor SVG/image)
  drawCursorShape(ctx, x, y, cursorSize, shape, color);
}

/**
 * Draw cursor shape on canvas
 */
function drawCursorShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shape: string,
  color: string
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;

  switch (shape) {
    case 'arrow':
      drawArrowCursor(ctx, x, y, size);
      break;
    case 'pointer':
      drawPointerCursor(ctx, x, y, size);
      break;
    case 'hand':
      drawHandCursor(ctx, x, y, size);
      break;
    case 'crosshair':
      drawCrosshairCursor(ctx, x, y, size);
      break;
    default:
      drawArrowCursor(ctx, x, y, size);
  }

  ctx.restore();
}

function drawArrowCursor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const scale = size / 20;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 16 * scale, y + 4 * scale);
  ctx.lineTo(x + 12 * scale, y + 8 * scale);
  ctx.lineTo(x + 18 * scale, y + 14 * scale);
  ctx.lineTo(x + 14 * scale, y + 16 * scale);
  ctx.lineTo(x + 8 * scale, y + 10 * scale);
  ctx.lineTo(x + 4 * scale, y + 16 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawPointerCursor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const scale = size / 20;
  ctx.beginPath();
  ctx.moveTo(x + 2 * scale, y + 2 * scale);
  ctx.lineTo(x + 14 * scale, y + 2 * scale);
  ctx.lineTo(x + 14 * scale, y + 8 * scale);
  ctx.lineTo(x + 18 * scale, y + 8 * scale);
  ctx.lineTo(x + 10 * scale, y + 18 * scale);
  ctx.lineTo(x + 8 * scale, y + 14 * scale);
  ctx.lineTo(x + 2 * scale, y + 14 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawHandCursor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  // Simplified hand cursor
  const scale = size / 20;
  ctx.beginPath();
  ctx.arc(x + 10 * scale, y + 10 * scale, 8 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawCrosshairCursor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const scale = size / 20;
  const center = 10 * scale;
  ctx.beginPath();
  ctx.moveTo(x + center, y + 2 * scale);
  ctx.lineTo(x + center, y + 8 * scale);
  ctx.moveTo(x + center, y + 12 * scale);
  ctx.lineTo(x + center, y + 18 * scale);
  ctx.moveTo(x + 2 * scale, y + center);
  ctx.lineTo(x + 8 * scale, y + center);
  ctx.moveTo(x + 12 * scale, y + center);
  ctx.lineTo(x + 18 * scale, y + center);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + center, y + center, 1.5 * scale, 0, Math.PI * 2);
  ctx.fill();
}

