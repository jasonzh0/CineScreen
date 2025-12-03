import type { RecordingMetadata } from '../../types/metadata';
import { generateSmoothedZoom, type ZoomRegion } from '../../processing/zoom-tracker';

// Cache for smoothed zoom regions
let cachedRegions: ZoomRegion[] | null = null;
let cachedMetadataHash: string | null = null;

/**
 * Generate a hash of the zoom configuration to detect changes
 */
function getZoomHash(metadata: RecordingMetadata): string {
  const sections = metadata.zoom.sections;
  const config = metadata.zoom.config;
  return JSON.stringify({
    enabled: config.enabled,
    level: config.level,
    sections: sections.map(s => ({
      startTime: s.startTime,
      endTime: s.endTime,
      scale: s.scale,
      centerX: s.centerX,
      centerY: s.centerY,
    })),
  });
}

/**
 * Get zoom region for a specific timestamp using smoothed zoom generation
 */
function getZoomRegion(
  metadata: RecordingMetadata,
  timestamp: number,
  videoWidth: number,
  videoHeight: number
): ZoomRegion | null {
  const { sections, config } = metadata.zoom;

  if (!config.enabled || sections.length === 0) {
    return null;
  }

  // Check if we need to regenerate the cache
  const currentHash = getZoomHash(metadata);
  if (cachedMetadataHash !== currentHash || !cachedRegions) {
    // Regenerate smoothed zoom regions
    cachedRegions = generateSmoothedZoom(
      sections,
      { width: videoWidth, height: videoHeight },
      config,
      metadata.video.frameRate,
      metadata.video.duration
    );
    cachedMetadataHash = currentHash;
  }

  // Find the region for the current timestamp
  const frameInterval = 1000 / metadata.video.frameRate;
  const frameIndex = Math.floor(timestamp / frameInterval);

  if (frameIndex >= 0 && frameIndex < cachedRegions.length) {
    return cachedRegions[frameIndex];
  }

  return null;
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
  const zoomRegion = getZoomRegion(
    metadata,
    timestamp,
    videoWidth,
    videoHeight
  );

  if (!zoomRegion || zoomRegion.scale <= 1.0) {
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
  ctx.fillText(`${zoomRegion.scale.toFixed(1)}x`, cropX + 5, cropY + 20);

  ctx.setLineDash([]);
}

