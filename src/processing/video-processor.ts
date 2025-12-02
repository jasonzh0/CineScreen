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
  VIDEO_ENCODING_CRF,
  FRAME_BATCH_SIZE,
  FRAME_NUMBER_PADDING,
  DEFAULT_CURSOR_SIZE,
  DEFAULT_CURSOR_COLOR,
  DEFAULT_CURSOR_SHAPE,
  PROGRESS_ANALYZING_VIDEO,
  PROGRESS_EXTRACTING_FRAMES,
  PROGRESS_PREPARING_CURSOR,
  PROGRESS_PROCESSING_MOUSE_DATA,
  PROGRESS_RENDERING_START,
  PROGRESS_RENDERING_RANGE,
  PROGRESS_ENCODING_VIDEO,
  PROGRESS_COMPLETE,
} from '../utils/constants';
import {
  extractFrames,
  encodeFrames,
  cleanupFrames,
  getFrameFiles,
} from './frame-extractor';
import {
  renderFrame,
  createFrameDataFromEvents,
  createFrameDataFromKeyframes,
  prepareCursorImage,
  type FrameRenderOptions,
  type FrameData,
} from './sharp-renderer';

const logger = createLogger('VideoProcessor');

/**
 * Calculate output dimensions using captured video size
 * Ensures even dimensions for video encoding
 */
function calculateOutputDimensions(
  inputWidth: number,
  inputHeight: number
): { width: number; height: number } {
  // Use captured dimensions, ensuring even numbers for video encoding
  return {
    width: inputWidth % 2 === 0 ? inputWidth : inputWidth + 1,
    height: inputHeight % 2 === 0 ? inputHeight : inputHeight + 1,
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
        size: DEFAULT_CURSOR_SIZE,
        shape: DEFAULT_CURSOR_SHAPE,
        color: DEFAULT_CURSOR_COLOR,
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
      onProgress?.(PROGRESS_ANALYZING_VIDEO, 'Analyzing video...');
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
      onProgress?.(PROGRESS_EXTRACTING_FRAMES, 'Extracting frames...');
      logger.info('Extracting frames from video...');
      
      const extractionResult = await extractFrames({
        inputVideo,
        outputDir: tempDir,
        frameRate,
      });
      extractedFrameDir = extractionResult.frameDir;
      logger.info(`Extracted ${extractionResult.frameCount} frames`);

      // Step 3: Prepare cursor image
      onProgress?.(PROGRESS_PREPARING_CURSOR, 'Preparing cursor...');
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
      onProgress?.(PROGRESS_PROCESSING_MOUSE_DATA, 'Processing mouse data...');
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

      // Step 7: Calculate output dimensions (use captured video size)
      const outputDimensions = calculateOutputDimensions(
        videoDimensions.width,
        videoDimensions.height
      );
      logger.info('Output dimensions:', outputDimensions);

      // Step 8: Render frames with Sharp
      onProgress?.(PROGRESS_RENDERING_START, 'Rendering frames...');
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
      const batchSize = FRAME_BATCH_SIZE;
      
      for (let i = 0; i < totalFrames; i += batchSize) {
        const batch = frameDataList.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (frameData) => {
            const frameNum = String(frameData.frameIndex + 1).padStart(FRAME_NUMBER_PADDING, '0');
            const inputPath = join(extractedFrameDir!, `frame_${frameNum}.png`);
            const outputPath = join(renderedFrameDir!, `frame_${frameNum}.png`);

            if (!existsSync(inputPath)) {
              logger.warn(`Frame not found: ${inputPath}`);
              return;
            }

            await renderFrame(inputPath, outputPath, { ...frameData }, renderOptions);
          })
        );

        // Update progress (PROGRESS_RENDERING_START to PROGRESS_RENDERING_START + PROGRESS_RENDERING_RANGE for rendering)
        const progress = PROGRESS_RENDERING_START + Math.round((i / totalFrames) * PROGRESS_RENDERING_RANGE);
        onProgress?.(progress, `Rendering frames ${i + 1}-${Math.min(i + batchSize, totalFrames)}/${totalFrames}`);
      }

      logger.info('Frame rendering complete');

      // Step 9: Encode rendered frames to video
      onProgress?.(PROGRESS_ENCODING_VIDEO, 'Encoding video...');
      logger.info('Encoding rendered frames to video...');

      await encodeFrames({
        frameDir: renderedFrameDir,
        framePattern: 'frame_%06d.png',
        outputVideo,
        frameRate,
        width: outputDimensions.width,
        height: outputDimensions.height,
      });
      
      onProgress?.(PROGRESS_COMPLETE, 'Complete');
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
   * Uses keyframes directly to match preview timing exactly
   */
  async processVideoFromMetadata(options: VideoProcessingFromMetadataOptions): Promise<string> {
    const { inputVideo, outputVideo, metadata, onProgress } = options;

    // Validate inputs
    if (!inputVideo || !existsSync(inputVideo)) {
      throw new Error(`Input video file not found: ${inputVideo}`);
    }

    if (!outputVideo) {
      throw new Error('Output video path is required');
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
      // Step 1: Get video dimensions
      onProgress?.(PROGRESS_ANALYZING_VIDEO, 'Analyzing video...');
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
      onProgress?.(PROGRESS_EXTRACTING_FRAMES, 'Extracting frames...');
      logger.info('Extracting frames from video...');
      
      const frameRate = metadata.video.frameRate;
      const videoDuration = metadata.video.duration;
      
      const extractionResult = await extractFrames({
        inputVideo,
        outputDir: tempDir,
        frameRate,
      });
      extractedFrameDir = extractionResult.frameDir;
      logger.info(`Extracted ${extractionResult.frameCount} frames`);

      // Step 3: Prepare cursor image
      onProgress?.(PROGRESS_PREPARING_CURSOR, 'Preparing cursor...');
      const cursorConfig = metadata.cursor.config;
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
        
      // Step 5: Create frame data directly from keyframes (matching preview timing)
      onProgress?.(PROGRESS_PROCESSING_MOUSE_DATA, 'Processing keyframes...');
      const frameDataList = createFrameDataFromKeyframes(
        metadata.cursor.keyframes,
        metadata.zoom.keyframes,
        frameRate,
        videoDuration,
        videoDimensions,
        cursorConfig,
        metadata.zoom.config.enabled ? metadata.zoom.config : undefined
      );
      logger.info(`Created frame data for ${frameDataList.length} frames from keyframes`);

      // Step 6: Calculate output dimensions
      const outputDimensions = calculateOutputDimensions(
        videoDimensions.width,
        videoDimensions.height
      );
      logger.info('Output dimensions:', outputDimensions);

      // Step 7: Render frames with Sharp
      onProgress?.(PROGRESS_RENDERING_START, 'Rendering frames...');
      logger.info('Rendering frames with cursor overlay and zoom...');

      const renderOptions: FrameRenderOptions = {
        frameWidth: videoDimensions.width,
        frameHeight: videoDimensions.height,
        outputWidth: outputDimensions.width,
        outputHeight: outputDimensions.height,
        cursorImagePath: preparedCursorPath,
        cursorSize: cursorConfig.size,
        cursorConfig,
        zoomConfig: metadata.zoom.config.enabled ? metadata.zoom.config : undefined,
        frameRate,
      };

      // Process frames in batches with progress updates
      const totalFrames = frameDataList.length;
      const batchSize = FRAME_BATCH_SIZE;
      
      for (let i = 0; i < totalFrames; i += batchSize) {
        const batch = frameDataList.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (frameData) => {
            const frameNum = String(frameData.frameIndex + 1).padStart(FRAME_NUMBER_PADDING, '0');
            const inputPath = join(extractedFrameDir!, `frame_${frameNum}.png`);
            const outputPath = join(renderedFrameDir!, `frame_${frameNum}.png`);

            if (!existsSync(inputPath)) {
              logger.warn(`Frame not found: ${inputPath}`);
              return;
            }

            await renderFrame(inputPath, outputPath, { ...frameData }, renderOptions);
          })
        );

        // Update progress
        const progress = PROGRESS_RENDERING_START + Math.round((i / totalFrames) * PROGRESS_RENDERING_RANGE);
        onProgress?.(progress, `Rendering frames ${i + 1}-${Math.min(i + batchSize, totalFrames)}/${totalFrames}`);
      }

      logger.info('Frame rendering complete');

      // Step 8: Encode rendered frames to video
      onProgress?.(PROGRESS_ENCODING_VIDEO, 'Encoding video...');
      logger.info('Encoding rendered frames to video...');

      await encodeFrames({
        frameDir: renderedFrameDir,
        framePattern: 'frame_%06d.png',
        outputVideo,
        frameRate,
        width: outputDimensions.width,
        height: outputDimensions.height,
      });
      
      onProgress?.(PROGRESS_COMPLETE, 'Complete');
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
   * Uses captured video dimensions without scaling
   */
  async copyVideoWithScale(inputVideo: string, outputVideo: string): Promise<void> {
    const ffmpegPath = getFfmpegPath();
    
    // Copy video without scaling - use captured dimensions
    const args = [
      '-i', inputVideo,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', String(VIDEO_ENCODING_CRF),
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
