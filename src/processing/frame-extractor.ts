import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { getFfmpegPath } from '../utils/ffmpeg-path';
import { createLogger } from '../utils/logger';

const logger = createLogger('FrameExtractor');

export interface FrameExtractionOptions {
  inputVideo: string;
  outputDir: string;
  frameRate: number;
  quality?: number; // 1-31, lower is better quality (default: 2)
  startTime?: number; // seconds
  duration?: number; // seconds
}

export interface ExtractionResult {
  frameDir: string;
  frameCount: number;
  framePattern: string;
  width: number;
  height: number;
}

/**
 * Extract frames from video using FFmpeg
 * Returns frame directory and metadata
 */
export async function extractFrames(options: FrameExtractionOptions): Promise<ExtractionResult> {
  const {
    inputVideo,
    outputDir,
    frameRate,
    quality = 2,
    startTime,
    duration,
  } = options;

  if (!existsSync(inputVideo)) {
    throw new Error(`Input video not found: ${inputVideo}`);
  }

  // Create output directory
  const frameDir = join(outputDir, `frames_${Date.now()}`);
  if (!existsSync(frameDir)) {
    mkdirSync(frameDir, { recursive: true });
  }

  const ffmpegPath = getFfmpegPath();
  const framePattern = join(frameDir, 'frame_%06d.png');

  // Build FFmpeg arguments
  const args: string[] = [];

  // Add seeking if start time specified
  if (startTime !== undefined && startTime > 0) {
    args.push('-ss', startTime.toString());
  }

  args.push('-i', inputVideo);

  // Add duration if specified
  if (duration !== undefined && duration > 0) {
    args.push('-t', duration.toString());
  }

  // Output settings
  args.push(
    '-vf', `fps=${frameRate}`,
    '-q:v', quality.toString(),
    '-y',
    framePattern
  );

  logger.info('Extracting frames:', { inputVideo, frameDir, frameRate });
  logger.debug('FFmpeg args:', args.join(' '));

  // Get video dimensions first
  const dimensions = await getVideoDimensions(inputVideo);

  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn(ffmpegPath, args);
    let errorOutput = '';

    ffmpegProcess.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        // Count extracted frames
        const files = readdirSync(frameDir).filter(f => f.endsWith('.png'));
        const frameCount = files.length;

        if (frameCount === 0) {
          reject(new Error('No frames extracted'));
          return;
        }

        logger.info(`Extracted ${frameCount} frames to ${frameDir}`);
        resolve({
          frameDir,
          frameCount,
          framePattern: 'frame_%06d.png',
          width: dimensions.width,
          height: dimensions.height,
        });
      } else {
        reject(new Error(`Frame extraction failed: ${errorOutput.substring(0, 500)}`));
      }
    });

    ffmpegProcess.on('error', (error) => {
      reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      ffmpegProcess.kill();
      reject(new Error('Frame extraction timed out'));
    }, 300000);
  });
}

/**
 * Encode frames back to video using FFmpeg
 */
export async function encodeFrames(options: {
  frameDir: string;
  framePattern: string;
  outputVideo: string;
  frameRate: number;
  width?: number;
  height?: number;
}): Promise<void> {
  const { frameDir, framePattern, outputVideo, frameRate, width, height } = options;
  const ffmpegPath = getFfmpegPath();
  const inputPattern = join(frameDir, framePattern);

  const args: string[] = [
    '-framerate', frameRate.toString(),
    '-i', inputPattern,
  ];

  // Add scaling if dimensions specified
  if (width && height) {
    args.push('-vf', `scale=${width}:${height}`);
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', 'faststart',
    '-y',
    outputVideo
  );

  logger.info('Encoding frames to video:', { outputVideo, frameRate });
  logger.debug('FFmpeg args:', args.join(' '));

  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn(ffmpegPath, args);
    let errorOutput = '';

    ffmpegProcess.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0 && existsSync(outputVideo)) {
        logger.info('Video encoded successfully');
        resolve();
      } else {
        reject(new Error(`Encoding failed: ${errorOutput.substring(0, 500)}`));
      }
    });

    ffmpegProcess.on('error', (error) => {
      reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      ffmpegProcess.kill();
      reject(new Error('Encoding timed out'));
    }, 600000);
  });
}

/**
 * Get video dimensions using FFprobe
 */
async function getVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  const ffmpegPath = getFfmpegPath();
  // FFprobe is usually in the same directory as FFmpeg
  const ffprobePath = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');

  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=s=x:p=0',
      videoPath
    ];

    const process = spawn(ffprobePath, args);
    let output = '';
    let errorOutput = '';

    process.stdout?.on('data', (data) => {
      output += data.toString();
    });

    process.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        const [widthStr, heightStr] = output.trim().split('x');
        const width = parseInt(widthStr, 10);
        const height = parseInt(heightStr, 10);

        if (isNaN(width) || isNaN(height)) {
          // Fallback to common dimensions
          resolve({ width: 1920, height: 1080 });
        } else {
          resolve({ width, height });
        }
      } else {
        // Fallback on error
        logger.warn('Could not get video dimensions, using default 1920x1080');
        resolve({ width: 1920, height: 1080 });
      }
    });

    process.on('error', () => {
      // Fallback on error
      resolve({ width: 1920, height: 1080 });
    });
  });
}

/**
 * Clean up extracted frames
 */
export function cleanupFrames(frameDir: string): void {
  if (!existsSync(frameDir)) return;

  try {
    const files = readdirSync(frameDir);
    for (const file of files) {
      unlinkSync(join(frameDir, file));
    }
    rmdirSync(frameDir);
    logger.debug('Cleaned up frame directory:', frameDir);
  } catch (error) {
    logger.warn('Failed to cleanup frames:', error);
  }
}

/**
 * Get list of frame files in a directory
 */
export function getFrameFiles(frameDir: string): string[] {
  if (!existsSync(frameDir)) return [];
  
  return readdirSync(frameDir)
    .filter(f => f.endsWith('.png'))
    .sort()
    .map(f => join(frameDir, f));
}



