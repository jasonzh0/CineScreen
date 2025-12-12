import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import type { MouseEvent, CursorConfig, MouseEffectsConfig, ZoomConfig } from '../types';
import type { RecordingMetadata, CursorKeyframe } from '../types/metadata';
import { interpolateMousePositions } from './effects';
import { getCursorAssetFilePath } from './cursor-renderer';
import { getFfmpegPath } from '../utils/ffmpeg-path';
import { getVideoDimensions, getScreenDimensions } from './video-utils';
import { createLogger } from '../utils/logger';
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

export interface VideoProcessingFromMetadataOptions {
  inputVideo: string;
  outputVideo: string;
  metadata: RecordingMetadata;
  onProgress?: (percent: number, message: string) => void;
}

export class VideoProcessor {
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
      logger.info('Video dimensions (from file):', videoDimensions);
      logger.info('Video dimensions (from metadata):', { width: metadata.video.width, height: metadata.video.height });

      // Check for dimension mismatch
      if (videoDimensions.width !== metadata.video.width || videoDimensions.height !== metadata.video.height) {
        logger.warn(`Video dimension mismatch! File: ${videoDimensions.width}x${videoDimensions.height}, Metadata: ${metadata.video.width}x${metadata.video.height}`);
        logger.warn('Using actual file dimensions for rendering');
      }

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

      // Calculate actual video duration from extracted frames
      // This ensures cursor animation matches the actual video length
      const actualVideoDuration = (extractionResult.frameCount / frameRate) * 1000; // Convert to milliseconds
      const effectiveVideoDuration = Math.min(videoDuration, actualVideoDuration);

      if (actualVideoDuration < videoDuration) {
        logger.warn(
          `Video duration mismatch: metadata says ${videoDuration}ms but actual video is ${actualVideoDuration}ms. ` +
          `Using actual duration to match extracted frames.`
        );
      }

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
      // Coordinates in metadata are already in video space (converted during export)
      // Use effectiveVideoDuration to match actual extracted frames
      onProgress?.(PROGRESS_PROCESSING_MOUSE_DATA, 'Processing keyframes...');
      const frameDataList = createFrameDataFromKeyframes(
        metadata.cursor.keyframes,
        metadata.zoom.sections,
        frameRate,
        effectiveVideoDuration,
        videoDimensions,
        cursorConfig,
        metadata.zoom.config.enabled ? metadata.zoom.config : undefined,
        metadata.clicks
      );
      logger.info(`Created frame data for ${frameDataList.length} frames from keyframes (matching ${extractionResult.frameCount} extracted frames)`);

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
      // Limit to actual extracted frame count to avoid processing non-existent frames
      const maxFrameIndex = extractionResult.frameCount;
      const totalFrames = Math.min(frameDataList.length, maxFrameIndex);
      const batchSize = FRAME_BATCH_SIZE;

      if (frameDataList.length > maxFrameIndex) {
        logger.warn(
          `Frame data list (${frameDataList.length} frames) exceeds extracted frames (${maxFrameIndex}). ` +
          `Limiting to ${maxFrameIndex} frames to match video.`
        );
      }

      for (let i = 0; i < totalFrames; i += batchSize) {
        const batch = frameDataList.slice(i, i + batchSize);

        // Process batch in parallel for maximum performance
        await Promise.all(
          batch.map(async (frameData) => {
            if (frameData.frameIndex >= maxFrameIndex) {
              return;
            }

            const frameNum = String(frameData.frameIndex + 1).padStart(FRAME_NUMBER_PADDING, '0');
            const inputPath = join(extractedFrameDir!, `frame_${frameNum}.png`);
            const outputPath = join(renderedFrameDir!, `frame_${frameNum}.png`);

            if (!existsSync(inputPath)) {
              logger.warn(`Frame not found: ${inputPath}`);
              return;
            }

            try {
              await renderFrame(inputPath, outputPath, { ...frameData }, renderOptions);
            } catch (error) {
              logger.warn(`Failed to render frame ${frameNum}:`, error);
            }
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

}
