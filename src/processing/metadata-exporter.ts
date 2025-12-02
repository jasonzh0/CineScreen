import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { MouseEvent, CursorConfig, ZoomConfig, MouseEffectsConfig } from '../types';
import type { RecordingMetadata, CursorKeyframe, ZoomKeyframe, ClickEvent, VideoInfo } from '../types/metadata';
import type { ZoomRegion } from './zoom-tracker';
import { generateZoomRegions } from './zoom-tracker';
import { getVideoDimensions } from './video-utils';
import { createLogger } from '../utils/logger';

const logger = createLogger('MetadataExporter');

const METADATA_VERSION = '1.0.0';

/**
 * Converts raw mouse events to cursor keyframes
 * Extracts significant position changes and click events
 */
function convertMouseEventsToKeyframes(
  mouseEvents: MouseEvent[],
  videoDuration: number,
  frameRate: number,
  convertToVideoCoordinates?: (x: number, y: number) => { x: number; y: number }
): { cursorKeyframes: CursorKeyframe[]; clickEvents: ClickEvent[] } {
  const cursorKeyframes: CursorKeyframe[] = [];
  const clickEvents: ClickEvent[] = [];

  if (mouseEvents.length === 0) {
    return { cursorKeyframes, clickEvents };
  }

  // Helper to convert coordinates if converter is provided
  const convertCoords = (x: number, y: number) => {
    return convertToVideoCoordinates ? convertToVideoCoordinates(x, y) : { x, y };
  };
  
  // Extract click events and convert coordinates
  for (const event of mouseEvents) {
    if (event.action === 'down' || event.action === 'up') {
      if (event.button) {
        const pos = convertCoords(event.x, event.y);
        clickEvents.push({
          timestamp: event.timestamp,
          x: pos.x,
          y: pos.y,
          button: event.button,
          action: event.action,
        });
      }
    }
  }

  // Only store start and end keyframes - all intermediate positions are interpolated
  // Find first and last move events
  const moveEvents = mouseEvents.filter(e => e.action === 'move');
  
  if (moveEvents.length > 0) {
    const firstMove = moveEvents[0];
    const lastMove = moveEvents[moveEvents.length - 1];
    
    // Convert screen coordinates to video coordinates
    const firstPos = convertCoords(firstMove.x, firstMove.y);
    const lastPos = convertCoords(lastMove.x, lastMove.y);
    
    // Start keyframe at timestamp 0 (beginning of video)
        cursorKeyframes.push({
      timestamp: 0,
      x: firstPos.x,
      y: firstPos.y,
      easing: 'easeInOut', // Default easing for the segment
    });
    
    // End keyframe at video duration (end of video)
    // Only add if position changed or we have a valid duration
    if (videoDuration > 0 && (firstPos.x !== lastPos.x || firstPos.y !== lastPos.y || videoDuration > firstMove.timestamp)) {
          cursorKeyframes.push({
        timestamp: videoDuration,
        x: lastPos.x,
        y: lastPos.y,
          });
    }
  } else if (mouseEvents.length > 0) {
    // Fallback: use first event if no move events
    const firstEvent = mouseEvents[0];
    const firstPos = convertCoords(firstEvent.x, firstEvent.y);
    cursorKeyframes.push({
      timestamp: 0,
      x: firstPos.x,
      y: firstPos.y,
      easing: 'easeInOut',
    });

    // Add end keyframe at video duration
    if (videoDuration > 0) {
      const lastEvent = mouseEvents[mouseEvents.length - 1];
      const lastPos = convertCoords(lastEvent.x, lastEvent.y);
      cursorKeyframes.push({
        timestamp: videoDuration,
        x: lastPos.x,
        y: lastPos.y,
      });
    }
  }

  // Sort by timestamp
  cursorKeyframes.sort((a, b) => a.timestamp - b.timestamp);
  clickEvents.sort((a, b) => a.timestamp - b.timestamp);

  logger.info(
    `Converted ${mouseEvents.length} mouse events to ${cursorKeyframes.length} cursor keyframes and ${clickEvents.length} click events`
  );

  return { cursorKeyframes, clickEvents };
}

/**
 * Converts zoom regions to zoom keyframes
 * Only stores start (timestamp 0) and end (videoDuration) keyframes
 */
function convertZoomRegionsToKeyframes(
  zoomRegions: ZoomRegion[],
  videoDuration: number
): ZoomKeyframe[] {
  const zoomKeyframes: ZoomKeyframe[] = [];

  if (zoomRegions.length === 0) {
    return zoomKeyframes;
  }

  // Only store start and end keyframes - all intermediate zoom states are interpolated
  if (zoomRegions.length > 0) {
    const firstRegion = zoomRegions[0];
    const lastRegion = zoomRegions[zoomRegions.length - 1];
    
    // Start keyframe at timestamp 0 (beginning of video)
    zoomKeyframes.push({
      timestamp: 0,
      centerX: firstRegion.centerX,
      centerY: firstRegion.centerY,
      level: firstRegion.scale,
      cropWidth: firstRegion.cropWidth,
      cropHeight: firstRegion.cropHeight,
      easing: 'easeInOut', // Default easing for the segment
    });
    
    // End keyframe at video duration (end of video)
    // Only add if zoom changed or we have a valid duration
    if (videoDuration > 0 && (
        firstRegion.scale !== lastRegion.scale ||
        firstRegion.centerX !== lastRegion.centerX ||
        firstRegion.centerY !== lastRegion.centerY ||
        videoDuration > firstRegion.timestamp
      )) {
      zoomKeyframes.push({
        timestamp: videoDuration,
        centerX: lastRegion.centerX,
        centerY: lastRegion.centerY,
        level: lastRegion.scale,
        cropWidth: lastRegion.cropWidth,
        cropHeight: lastRegion.cropHeight,
      });
    }
  }

  // Sort by timestamp
  zoomKeyframes.sort((a, b) => a.timestamp - b.timestamp);

  logger.info(`Converted ${zoomRegions.length} zoom regions to ${zoomKeyframes.length} zoom keyframes`);

  return zoomKeyframes;
}

/**
 * Metadata exporter - converts recording data to metadata format
 */
export class MetadataExporter {
  /**
   * Export metadata to JSON file alongside video
   */
  async exportMetadata(options: {
    videoPath: string;
    mouseEvents: MouseEvent[];
    cursorConfig: CursorConfig;
    zoomConfig?: ZoomConfig;
    mouseEffectsConfig?: MouseEffectsConfig;
    frameRate: number;
    videoDuration: number;
    screenDimensions?: { width: number; height: number };
    recordingRegion?: { x: number; y: number; width: number; height: number };
  }): Promise<string> {
    const {
      videoPath,
      mouseEvents,
      cursorConfig,
      zoomConfig,
      mouseEffectsConfig,
      frameRate,
      videoDuration,
      screenDimensions,
      recordingRegion,
    } = options;

    logger.info('Exporting metadata for video:', videoPath);

    // Get video dimensions
    let videoDimensions: { width: number; height: number };
    try {
      videoDimensions = await getVideoDimensions(videoPath);
    } catch (error) {
      logger.error('Failed to get video dimensions:', error);
      throw new Error(`Failed to get video dimensions: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Convert mouse coordinates from screen space to video space
    // If a recording region was used, coordinates need to be offset
    // If screen dimensions differ from video dimensions, coordinates need to be scaled
    const convertToVideoCoordinates = (screenX: number, screenY: number): { x: number; y: number } => {
      let x = screenX;
      let y = screenY;

      // If recording region was used, subtract the offset
      if (recordingRegion) {
        x = screenX - recordingRegion.x;
        y = screenY - recordingRegion.y;
        logger.debug(`Converted (${screenX}, ${screenY}) to (${x}, ${y}) using region offset`);
      } else if (screenDimensions) {
        // Scale coordinates if screen dimensions differ from video dimensions
        const scaleX = videoDimensions.width / screenDimensions.width;
        const scaleY = videoDimensions.height / screenDimensions.height;
        x = screenX * scaleX;
        y = screenY * scaleY;
        logger.debug(`Converted (${screenX}, ${screenY}) to (${x}, ${y}) using scale (${scaleX}, ${scaleY})`);
      }

      // Clamp to video bounds
      x = Math.max(0, Math.min(videoDimensions.width, x));
      y = Math.max(0, Math.min(videoDimensions.height, y));

      return { x, y };
    };

    // Create video info
    const videoInfo: VideoInfo = {
      path: videoPath,
      width: videoDimensions.width,
      height: videoDimensions.height,
      frameRate,
      duration: videoDuration,
    };

    // Convert mouse events to cursor keyframes and click events
    const { cursorKeyframes, clickEvents } = convertMouseEventsToKeyframes(
      mouseEvents,
      videoDuration,
      frameRate,
      convertToVideoCoordinates
    );

    // Generate zoom regions if zoom is enabled
    let zoomKeyframes: ZoomKeyframe[] = [];
    if (zoomConfig?.enabled) {
      // Convert mouse events to video coordinates before generating zoom regions
      const convertedMouseEvents = mouseEvents.map(event => {
        const pos = convertToVideoCoordinates(event.x, event.y);
        return {
          ...event,
          x: pos.x,
          y: pos.y,
        };
      });
      
      const videoDims = {
        width: videoDimensions.width,
        height: videoDimensions.height,
      };
      const zoomRegions = generateZoomRegions(
        convertedMouseEvents,
        videoDims,
        zoomConfig,
        frameRate,
        videoDuration
      );
      zoomKeyframes = convertZoomRegionsToKeyframes(zoomRegions, videoDuration);
    } else {
      // Add default no-zoom keyframe
      zoomKeyframes.push({
        timestamp: 0,
        centerX: videoDimensions.width / 2,
        centerY: videoDimensions.height / 2,
        level: 1.0,
        cropWidth: videoDimensions.width,
        cropHeight: videoDimensions.height,
      });
    }

    // Create metadata object
    const metadata: RecordingMetadata = {
      version: METADATA_VERSION,
      video: videoInfo,
      cursor: {
        keyframes: cursorKeyframes,
        config: cursorConfig,
      },
      zoom: {
        keyframes: zoomKeyframes,
        config: zoomConfig || {
          enabled: false,
          level: 1.0,
          transitionSpeed: 300,
          padding: 0,
          followSpeed: 1.0,
        },
      },
      clicks: clickEvents,
      effects: mouseEffectsConfig,
      createdAt: Date.now(),
    };

    // Determine output path (same directory as video, with .json extension)
    const videoDir = dirname(videoPath);
    const videoBasename = videoPath.replace(/\.[^/.]+$/, ''); // Remove extension
    const metadataPath = `${videoBasename}.json`;

    // Ensure directory exists
    if (!existsSync(videoDir)) {
      mkdirSync(videoDir, { recursive: true });
    }

    // Write metadata to file
    try {
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
      logger.info(`Metadata exported successfully to: ${metadataPath}`);
      return metadataPath;
    } catch (error) {
      logger.error('Failed to write metadata file:', error);
      throw new Error(`Failed to write metadata file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load metadata from JSON file
   */
  static loadMetadata(metadataPath: string): RecordingMetadata {
    const { readFileSync } = require('fs');
    try {
      const data = readFileSync(metadataPath, 'utf-8');
      const metadata = JSON.parse(data) as RecordingMetadata;
      logger.info(`Metadata loaded from: ${metadataPath}`);
      return metadata;
    } catch (error) {
      logger.error('Failed to load metadata:', error);
      throw new Error(`Failed to load metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

