import type { RecordingMetadata, ZoomKeyframe, EasingType } from '../../types/metadata';
import { easeInOut, easeIn, easeOut } from '../../processing/effects';

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
 * Interpolate zoom region between keyframes
 */
function interpolateZoomRegion(
  keyframes: ZoomKeyframe[],
  timestamp: number,
  videoWidth: number,
  videoHeight: number
): { centerX: number; centerY: number; level: number; cropWidth: number; cropHeight: number } | null {
  if (keyframes.length === 0) {
    return {
      centerX: videoWidth / 2,
      centerY: videoHeight / 2,
      level: 1.0,
      cropWidth: videoWidth,
      cropHeight: videoHeight,
    };
  }

  if (keyframes.length === 1) {
    const kf = keyframes[0];
    return {
      centerX: kf.centerX,
      centerY: kf.centerY,
      level: kf.level,
      cropWidth: kf.cropWidth || videoWidth / kf.level,
      cropHeight: kf.cropHeight || videoHeight / kf.level,
    };
  }

  // Find the two keyframes that bracket this timestamp
  let prevKeyframe: ZoomKeyframe | null = null;
  let nextKeyframe: ZoomKeyframe | null = null;

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
      centerX: prevKeyframe.centerX,
      centerY: prevKeyframe.centerY,
      level: prevKeyframe.level,
      cropWidth: prevKeyframe.cropWidth || videoWidth / prevKeyframe.level,
      cropHeight: prevKeyframe.cropHeight || videoHeight / prevKeyframe.level,
    };
  }

  // Interpolate between keyframes
  const timeDiff = nextKeyframe.timestamp - prevKeyframe.timestamp;
  const t = timeDiff > 0 ? (timestamp - prevKeyframe.timestamp) / timeDiff : 0;
  // Use easing from start keyframe, or default to easeInOut
  const easingType: EasingType = prevKeyframe.easing || 'easeInOut';
  const easedT = applyEasing(t, easingType);

  const centerX = prevKeyframe.centerX + (nextKeyframe.centerX - prevKeyframe.centerX) * easedT;
  const centerY = prevKeyframe.centerY + (nextKeyframe.centerY - prevKeyframe.centerY) * easedT;
  const level = prevKeyframe.level + (nextKeyframe.level - prevKeyframe.level) * easedT;
  const cropWidth = prevKeyframe.cropWidth || videoWidth / prevKeyframe.level;
  const nextCropWidth = nextKeyframe.cropWidth || videoWidth / nextKeyframe.level;
  const cropHeight = prevKeyframe.cropHeight || videoHeight / prevKeyframe.level;
  const nextCropHeight = nextKeyframe.cropHeight || videoHeight / nextKeyframe.level;

  return {
    centerX,
    centerY,
    level,
    cropWidth: cropWidth + (nextCropWidth - cropWidth) * easedT,
    cropHeight: cropHeight + (nextCropHeight - cropHeight) * easedT,
  };
}

/**
 * Render zoom region visualization on canvas
 */
export function renderZoom(
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

  // Only render if zoom is enabled
  if (!metadata.zoom.config.enabled) {
    return;
  }

  // Get zoom region at this timestamp
  const zoomRegion = interpolateZoomRegion(
    metadata.zoom.keyframes,
    timestamp,
    videoWidth,
    videoHeight
  );

  if (!zoomRegion || zoomRegion.level <= 1.0) {
    return;
  }

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

  // Calculate crop region in display coordinates with offset
  const cropX = (zoomRegion.centerX - zoomRegion.cropWidth / 2) * scale + offsetX;
  const cropY = (zoomRegion.centerY - zoomRegion.cropHeight / 2) * scale + offsetY;
  const cropW = zoomRegion.cropWidth * scale;
  const cropH = zoomRegion.cropHeight * scale;

  // Draw crop boundaries
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  
  // Draw rectangle
  ctx.strokeRect(cropX, cropY, cropW, cropH);

  // Draw center point
  const centerX = zoomRegion.centerX * scale + offsetX;
  const centerY = zoomRegion.centerY * scale + offsetY;
  ctx.fillStyle = '#ff6b6b';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Draw zoom level indicator
  ctx.fillStyle = '#ff6b6b';
  ctx.font = '12px monospace';
  ctx.fillText(`${zoomRegion.level.toFixed(1)}x`, cropX + 5, cropY + 20);

  ctx.setLineDash([]);
}

