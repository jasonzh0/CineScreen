import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { MouseEvent, CursorConfig, MouseEffectsConfig, ZoomConfig } from '../types';
import { smoothMouseMovement, interpolateMousePositions } from './effects';
import { getCursorAssetFilePath } from './cursor-renderer';
import { getFfmpegPath } from '../utils/ffmpeg-path';
import { createCursorOverlayFilter, createMouseEffectsFilter, combineFilters } from './ffmpeg-filters';
import { getVideoDimensions, ensureCursorPNG } from './video-utils';
import { generateAllMouseEffects } from './mouse-effects';
import { generateZoomRegions } from './zoom-tracker';
import { generateZoomFilter } from './zoom-processor';
import { createLogger } from '../utils/logger';

const logger = createLogger('VideoProcessor');

export interface VideoProcessingOptions {
  inputVideo: string;
  outputVideo: string;
  mouseEvents: MouseEvent[];
  cursorConfig: CursorConfig;
  mouseEffectsConfig?: MouseEffectsConfig;
  zoomConfig?: ZoomConfig;
  frameRate: number;
  videoDuration: number; // in milliseconds
}

export class VideoProcessor {
  /**
   * Process video and overlay cursor
   */
  async processVideo(options: VideoProcessingOptions): Promise<string> {
    try {
      const {
        inputVideo,
        outputVideo,
        mouseEvents,
        cursorConfig: initialCursorConfig,
        frameRate,
        videoDuration,
      } = options;
      
      // Make cursorConfig mutable for default assignment
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
          size: 24,
          shape: 'arrow',
          smoothing: 0.5,
          color: '#000000',
        };
      }

      // Ensure output directory exists
      const outputDir = dirname(outputVideo);
      try {
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }
      } catch (error) {
        throw new Error(`Failed to create output directory: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Apply smoothing to mouse events
      let smoothedEvents: MouseEvent[] = [];
      try {
        smoothedEvents = smoothMouseMovement(
          mouseEvents,
          cursorConfig.smoothing
        );
      } catch (error) {
        logger.warn('Error smoothing mouse events, using original events:', error);
        smoothedEvents = mouseEvents;
      }

      // Interpolate mouse positions for all frames
      let interpolatedEvents: MouseEvent[] = [];
      try {
        interpolatedEvents = interpolateMousePositions(
          smoothedEvents,
          frameRate,
          videoDuration
        );
      } catch (error) {
        throw new Error(`Failed to interpolate mouse positions: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Get video dimensions for zoom calculations
      let videoDimensions;
      try {
        videoDimensions = await getVideoDimensions(inputVideo);
      } catch (error) {
        throw new Error(`Failed to get video dimensions: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Generate zoom regions if zoom is enabled
      let zoomFilter = '';
      if (options.zoomConfig?.enabled) {
        try {
          const zoomRegions = generateZoomRegions(
            interpolatedEvents,
            videoDimensions,
            options.zoomConfig,
            frameRate,
            videoDuration
          );
          zoomFilter = generateZoomFilter(zoomRegions, videoDimensions, frameRate);
        } catch (error) {
          logger.warn('Error generating zoom filter, continuing without zoom:', error);
          zoomFilter = '';
        }
      }

      // Generate mouse effects if configured
      let effectFrames: any[] = [];
      if (options.mouseEffectsConfig) {
        try {
          effectFrames = generateAllMouseEffects(interpolatedEvents, options.mouseEffectsConfig, frameRate);
        } catch (error) {
          logger.warn('Error generating mouse effects, continuing without effects:', error);
          effectFrames = [];
        }
      }

      // Get cursor asset path (SVG from assets directory) and convert to PNG
      let cursorImagePath: string;
      try {
        const assetPath = getCursorAssetFilePath(cursorConfig.shape);
        if (!assetPath || !existsSync(assetPath)) {
          throw new Error(`Cursor asset not found for shape: ${cursorConfig.shape}`);
        }
        
        // Convert SVG to PNG for FFmpeg overlay (FFmpeg overlay works better with raster images)
        cursorImagePath = await ensureCursorPNG(assetPath, cursorConfig.size);
      } catch (error) {
        throw new Error(`Failed to get cursor asset: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Create FFmpeg filter complex
      let filterComplex: string;
      try {
        const filters: string[] = [];
        
        // Apply zoom first if enabled
        if (zoomFilter) {
          filters.push(zoomFilter);
        }
        
        // Determine input label for cursor (after zoom if enabled)
        const cursorInputLabel = zoomFilter ? '[zoomed]' : '[0:v]';
        
        // Create cursor overlay filter
        const cursorFilter = createCursorOverlayFilter(
          interpolatedEvents,
          cursorConfig.size
        );
        // Replace input label in cursor filter
        let adjustedCursorFilter = cursorFilter.replace('[0:v]', cursorInputLabel);
        
        // If we have effects, change cursor output to intermediate label
        if (effectFrames.length > 0) {
          adjustedCursorFilter = adjustedCursorFilter.replace('[out]', '[cursored]');
        }
        
        filters.push(adjustedCursorFilter);
        
        // Create mouse effects filter if effects are enabled
        if (effectFrames.length > 0) {
          const effectsFilter = createMouseEffectsFilter(
            effectFrames,
            frameRate,
            '[cursored]'
          );
          if (effectsFilter && effectsFilter.trim().length > 0) {
            filters.push(effectsFilter);
          }
        }
        
        // Combine all filters
        filterComplex = combineFilters(filters);
        
        // Debug: log the filter complex
        logger.debug('FFmpeg filter complex:', filterComplex);
        logger.debug('Cursor image path:', cursorImagePath);
        logger.debug('Cursor size:', cursorConfig.size);
        logger.debug('Interpolated events count:', interpolatedEvents.length);
      } catch (error) {
        throw new Error(`Failed to create FFmpeg filter: ${error instanceof Error ? error.message : String(error)}`);
      }

    // Build FFmpeg command
    // Note: -loop 1 for the cursor image makes it loop for the entire video duration
    const args = [
      '-i',
      inputVideo,
      '-loop',
      '1',
      '-i',
      cursorImagePath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[out]',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      'faststart',
      '-shortest', // End encoding when the shortest input stream ends
      '-y', // Overwrite output file
      outputVideo,
    ];

      return new Promise((resolve, reject) => {
        let ffmpegPath: string;
        try {
          // Get the resolved FFmpeg path using the utility function
          ffmpegPath = getFfmpegPath();
        } catch (error) {
          reject(new Error(`Failed to get FFmpeg path: ${error instanceof Error ? error.message : String(error)}`));
          return;
        }

        const ffmpegProcess = spawn(ffmpegPath, args);

        let errorOutput = '';
        let hasResolved = false;

        ffmpegProcess.stderr?.on('data', (data) => {
          errorOutput += data.toString();
        });

        ffmpegProcess.on('close', (code) => {
          if (hasResolved) return;
          hasResolved = true;
          
          if (code === 0) {
            // Verify output file exists
            if (existsSync(outputVideo)) {
              resolve(outputVideo);
            } else {
              reject(new Error(`FFmpeg completed but output file not found: ${outputVideo}`));
            }
          } else {
            const errorMessage = errorOutput.length > 500 
              ? errorOutput.substring(0, 500) + '...'
              : errorOutput;
            reject(
              new Error(`FFmpeg processing failed with code ${code}: ${errorMessage}`)
            );
          }
        });

        ffmpegProcess.on('error', (error) => {
          if (hasResolved) return;
          hasResolved = true;
          reject(new Error(`Failed to start FFmpeg: ${error.message}`));
        });

        // Timeout after 10 minutes
        setTimeout(() => {
          if (!hasResolved) {
            hasResolved = true;
            ffmpegProcess.kill();
            reject(new Error('FFmpeg processing timed out after 10 minutes'));
          }
        }, 600000);
      });
    } catch (error) {
      throw new Error(`Video processing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}

