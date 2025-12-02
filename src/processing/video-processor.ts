import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import type { MouseEvent, CursorConfig, MouseEffectsConfig, ZoomConfig } from '../types';
import type { RecordingMetadata, CursorKeyframe, ZoomKeyframe } from '../types/metadata';
import { interpolateMousePositions } from './effects';
import { getCursorAssetFilePath } from './cursor-renderer';
import { getFfmpegPath } from '../utils/ffmpeg-path';
import { getVideoDimensions, getScreenDimensions } from './video-utils';
import { createLogger } from '../utils/logger';
import { easeInOut, easeIn, easeOut } from './effects';
import type { EasingType } from '../types/metadata';
import {
  extractFrames,
  encodeFrames,
  cleanupFrames,
  getFrameFiles,
} from './frame-extractor';
import {
  renderFrame,
  createFrameDataFromEvents,
  prepareCursorImage,
  type FrameRenderOptions,
  type FrameData,
} from './sharp-renderer';

const logger = createLogger('VideoProcessor');

// Target output width (height calculated from aspect ratio)
const TARGET_WIDTH = 1080;

/**
 * Calculate output dimensions preserving aspect ratio
 */
function calculateOutputDimensions(
  inputWidth: number,
  inputHeight: number,
  targetWidth: number = TARGET_WIDTH
): { width: number; height: number } {
  const aspectRatio = inputHeight / inputWidth;
  const outputHeight = Math.round(targetWidth * aspectRatio);
  // Ensure even dimensions for video encoding
  return {
    width: targetWidth,
    height: outputHeight % 2 === 0 ? outputHeight : outputHeight + 1,
  };
}

export interface VideoProcessingOptions {
  inputVideo: string;
  outputVideo: string;
  mouseEvents: MouseEvent[];
  cursorConfig: CursorConfig;
  mouseEffectsConfig?: MouseEffectsConfig;
  zoomConfig?: ZoomConfig;
  frameRate: number;
  videoDuration: number; // in milliseconds
  onProgress?: (percent: number, message: string) => void;
}

export interface VideoProcessingFromMetadataOptions {
  inputVideo: string;
  outputVideo: string;
  metadata: RecordingMetadata;
  onProgress?: (percent: number, message: string) => void;
}

export class VideoProcessor {
  /**
   * Process video using Sharp-based frame rendering
   * Much faster than FFmpeg filter expressions
   */
  async processVideo(options: VideoProcessingOptions): Promise<string> {
    const {
      inputVideo,
      outputVideo,
      mouseEvents,
      cursorConfig: initialCursorConfig,
      frameRate,
      videoDuration,
      zoomConfig,
      onProgress,
    } = options;
    
    let cursorConfig = initialCursorConfig;

    // Validate inputs
    if (!inputVideo || !existsSync(inputVideo)) {
      throw new Error(`Input video file not found: ${inputVideo}`);
    }

    if (!outputVideo) {
      throw new Error('Output video path is required');
    }

    if (!mouseEvents || mouseEvents.length === 0) {
      logger.warn('No mouse events provided, processing video without cursor overlay');
    }

    // Validate and provide default cursor config
    if (!cursorConfig) {
      logger.warn('No cursor config provided, using defaults');
      cursorConfig = {
        size: 60,
        shape: 'arrow',
        color: '#000000',
      };
    }

    // Ensure output directory exists
    const outputDir = dirname(outputVideo);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const tempDir = outputDir;
    let extractedFrameDir: string | null = null;
    let renderedFrameDir: string | null = null;
    let preparedCursorPath: string | null = null;

    try {
      // Step 1: Get video and screen dimensions
      onProgress?.(5, 'Analyzing video...');
    const videoDimensions = await getVideoDimensions(inputVideo);
      logger.info('Video dimensions:', videoDimensions);

    let screenDimensions;
    try {
      screenDimensions = await getScreenDimensions();
      logger.debug('Screen dimensions:', screenDimensions);
    } catch (error) {
      logger.warn('Could not get screen dimensions, using video dimensions:', error);
      screenDimensions = videoDimensions;
    }

      // Step 2: Extract frames from video
      onProgress?.(10, 'Extracting frames...');
      logger.info('Extracting frames from video...');
      
      const extractionResult = await extractFrames({
        inputVideo,
        outputDir: tempDir,
        frameRate,
      });
      extractedFrameDir = extractionResult.frameDir;
      logger.info(`Extracted ${extractionResult.frameCount} frames`);

      // Step 3: Prepare cursor image
      onProgress?.(15, 'Preparing cursor...');
      const cursorAssetPath = getCursorAssetFilePath(cursorConfig.shape);
      if (!cursorAssetPath || !existsSync(cursorAssetPath)) {
      throw new Error(`Cursor asset not found for shape: ${cursorConfig.shape}`);
    }

      preparedCursorPath = join(tempDir, `cursor_${Date.now()}.png`);
      await prepareCursorImage(cursorAssetPath, cursorConfig.size, preparedCursorPath);
      logger.debug('Cursor image prepared:', preparedCursorPath);

      // Step 4: Create rendered frames directory
      renderedFrameDir = join(tempDir, `rendered_${Date.now()}`);
      mkdirSync(renderedFrameDir, { recursive: true });
        
      // Step 5: Interpolate mouse events for frame timing
      onProgress?.(20, 'Processing mouse data...');
      let interpolatedEvents: MouseEvent[] = [];
      try {
        interpolatedEvents = interpolateMousePositions(mouseEvents, frameRate, videoDuration);
          } catch (error) {
        throw new Error(`Failed to interpolate mouse positions: ${error instanceof Error ? error.message : String(error)}`);
        }

      // Step 6: Create frame data with cursor positions and zoom
      const frameDataList = createFrameDataFromEvents(
        interpolatedEvents,
        frameRate,
        videoDuration,
        videoDimensions,
        screenDimensions,
        cursorConfig,
        zoomConfig
      );
      logger.info(`Created frame data for ${frameDataList.length} frames`);

      // Step 7: Calculate output dimensions (preserve aspect ratio)
      const outputDimensions = calculateOutputDimensions(
        videoDimensions.width,
        videoDimensions.height,
        TARGET_WIDTH
      );
      logger.info('Output dimensions:', outputDimensions);

      // Step 8: Render frames with Sharp
      onProgress?.(25, 'Rendering frames...');
      logger.info('Rendering frames with cursor overlay and zoom...');

      const renderOptions: FrameRenderOptions = {
        frameWidth: videoDimensions.width,
        frameHeight: videoDimensions.height,
        outputWidth: outputDimensions.width,
        outputHeight: outputDimensions.height,
        cursorImagePath: preparedCursorPath,
        cursorSize: cursorConfig.size,
        cursorConfig,
        zoomConfig,
        frameRate,
      };

      // Process frames in batches with progress updates
      const totalFrames = frameDataList.length;
      const batchSize = 10;
      
      for (let i = 0; i < totalFrames; i += batchSize) {
        const batch = frameDataList.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (frameData) => {
            const frameNum = String(frameData.frameIndex + 1).padStart(6, '0');
            const inputPath = join(extractedFrameDir!, `frame_${frameNum}.png`);
            const outputPath = join(renderedFrameDir!, `frame_${frameNum}.png`);

            if (!existsSync(inputPath)) {
              logger.warn(`Frame not found: ${inputPath}`);
              return;
            }

            await renderFrame(inputPath, outputPath, { ...frameData }, renderOptions);
          })
        );

        // Update progress (25% to 85% for rendering)
        const progress = 25 + Math.round((i / totalFrames) * 60);
        onProgress?.(progress, `Rendering frames ${i + 1}-${Math.min(i + batchSize, totalFrames)}/${totalFrames}`);
      }

      logger.info('Frame rendering complete');

      // Step 9: Encode rendered frames to video
      onProgress?.(90, 'Encoding video...');
      logger.info('Encoding rendered frames to video...');

      await encodeFrames({
        frameDir: renderedFrameDir,
        framePattern: 'frame_%06d.png',
        outputVideo,
        frameRate,
        width: outputDimensions.width,
        height: outputDimensions.height,
      });
      
      onProgress?.(100, 'Complete');
      logger.info('Video processing completed successfully');

      return outputVideo;

    } finally {
      // Cleanup temp files
      if (extractedFrameDir) {
        try {
          cleanupFrames(extractedFrameDir);
        } catch (error) {
          logger.warn('Failed to cleanup extracted frames:', error);
        }
      }

      if (renderedFrameDir) {
        try {
          cleanupFrames(renderedFrameDir);
        } catch (error) {
          logger.warn('Failed to cleanup rendered frames:', error);
        }
      }

      if (preparedCursorPath && existsSync(preparedCursorPath)) {
        try {
          unlinkSync(preparedCursorPath);
        } catch (error) {
          logger.warn('Failed to cleanup cursor file:', error);
        }
      }
    }
  }

  /**
   * Process video from metadata (used by studio export)
   */
  async processVideoFromMetadata(options: VideoProcessingFromMetadataOptions): Promise<string> {
    const { inputVideo, outputVideo, metadata, onProgress } = options;

    // Convert metadata keyframes back to per-frame mouse events
    const frameRate = metadata.video.frameRate;
    const videoDuration = metadata.video.duration;
    const frameInterval = 1000 / frameRate;
    const totalFrames = Math.ceil(videoDuration / frameInterval);
    
    // Generate mouse events from cursor keyframes
    const mouseEvents: MouseEvent[] = [];
    for (let frame = 0; frame < totalFrames; frame++) {
      // Calculate timestamp, clamping to videoDuration to avoid floating-point precision issues
      const timestamp = Math.min(frame * frameInterval, videoDuration);
      const cursorPos = this.interpolateCursorKeyframe(metadata.cursor.keyframes, timestamp);
      if (cursorPos) {
        mouseEvents.push({
          timestamp,
          x: cursorPos.x,
          y: cursorPos.y,
          action: 'move',
        });
      }
    }

    // Add click events
    metadata.clicks.forEach(click => {
      mouseEvents.push({
        timestamp: click.timestamp,
        x: click.x,
        y: click.y,
        button: click.button,
        action: click.action,
      });
    });

    // Sort by timestamp
    mouseEvents.sort((a, b) => a.timestamp - b.timestamp);

    // Convert zoom keyframes to zoom config
    const zoomConfig: ZoomConfig | undefined = metadata.zoom.config.enabled ? {
      ...metadata.zoom.config,
    } : undefined;

    // Process video with converted data
    return this.processVideo({
      inputVideo,
      outputVideo,
      mouseEvents,
      cursorConfig: metadata.cursor.config,
      zoomConfig,
      mouseEffectsConfig: metadata.effects,
      frameRate,
      videoDuration,
      onProgress,
    });
  }

  /**
   * Interpolate cursor position from keyframes
   */
  private interpolateCursorKeyframe(
    keyframes: CursorKeyframe[],
    timestamp: number
  ): { x: number; y: number } | null {
    if (keyframes.length === 0) return null;
    if (keyframes.length === 1) {
      return { x: keyframes[0].x, y: keyframes[0].y };
    }

    // Find bracketing keyframes
    let prev: CursorKeyframe | null = null;
    let next: CursorKeyframe | null = null;

    for (let i = 0; i < keyframes.length; i++) {
      if (keyframes[i].timestamp <= timestamp) {
        prev = keyframes[i];
        next = keyframes[i + 1] || keyframes[i];
      } else {
        if (!prev) {
          prev = keyframes[0];
          next = keyframes[0];
        } else {
          next = keyframes[i];
        }
        break;
      }
    }

    if (!prev || !next) return null;
    if (prev.timestamp === next.timestamp) {
      return { x: prev.x, y: prev.y };
    }

    const timeDiff = next.timestamp - prev.timestamp;
    const t = timeDiff > 0 ? (timestamp - prev.timestamp) / timeDiff : 0;
    
    // Apply easing based on keyframe easing type
    const easingType: EasingType = prev.easing || 'easeInOut';
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
  }

  /**
   * Simple video copy without effects (for fallback)
   * Scales to target width while preserving aspect ratio
   */
  async copyVideoWithScale(inputVideo: string, outputVideo: string): Promise<void> {
    const ffmpegPath = getFfmpegPath();
    
    // scale=1080:-2 means width=1080, height=auto (divisible by 2 for encoding)
    const args = [
      '-i', inputVideo,
      '-vf', `scale=${TARGET_WIDTH}:-2`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', 'faststart',
      '-y',
      outputVideo
    ];

    return new Promise((resolve, reject) => {
      const process = spawn(ffmpegPath, args);
      let errorOutput = '';

      process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0 && existsSync(outputVideo)) {
          resolve();
        } else {
          reject(new Error(`Video copy failed: ${errorOutput.substring(0, 500)}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });
    });
  }
  }
