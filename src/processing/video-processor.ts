import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import type { MouseEvent, CursorConfig } from '../types';
import { smoothMouseMovement, interpolateMousePositions } from './effects';
import { generateCursorSVG, saveCursorToFile } from './cursor-renderer';

const execAsync = promisify(exec);

export interface VideoProcessingOptions {
  inputVideo: string;
  outputVideo: string;
  mouseEvents: MouseEvent[];
  cursorConfig: CursorConfig;
  frameRate: number;
  videoDuration: number; // in milliseconds
}

export class VideoProcessor {
  /**
   * Process video and overlay cursor
   */
  async processVideo(options: VideoProcessingOptions): Promise<string> {
    const {
      inputVideo,
      outputVideo,
      mouseEvents,
      cursorConfig,
      frameRate,
      videoDuration,
    } = options;

    // Ensure output directory exists
    const outputDir = dirname(outputVideo);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Apply smoothing to mouse events
    const smoothedEvents = smoothMouseMovement(
      mouseEvents,
      cursorConfig.smoothing
    );

    // Interpolate mouse positions for all frames
    const interpolatedEvents = interpolateMousePositions(
      smoothedEvents,
      frameRate,
      videoDuration
    );

    // Generate cursor image
    const cursorSVG = generateCursorSVG(cursorConfig);
    const tempCursorPath = join(outputDir, 'temp_cursor.svg');
    saveCursorToFile(tempCursorPath, cursorSVG);

    // Convert SVG to PNG if needed (FFmpeg can handle SVG with filters)
    // For simplicity, we'll use a PNG approach
    const cursorPNGPath = await this.ensureCursorPNG(
      tempCursorPath,
      cursorConfig.size
    );

    // Create FFmpeg filter complex for cursor overlay
    const filterComplex = this.createCursorOverlayFilter(
      interpolatedEvents,
      cursorPNGPath,
      cursorConfig.size,
      frameRate
    );

    // Build FFmpeg command
    const args = [
      '-i',
      inputVideo,
      '-i',
      cursorPNGPath,
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
      '-y', // Overwrite output file
      outputVideo,
    ];

    return new Promise((resolve, reject) => {
      // Use ffmpeg-static to get the bundled ffmpeg binary path
      const ffmpegPath = ffmpegStatic || 'ffmpeg';
      if (!ffmpegPath) {
        reject(new Error('FFmpeg binary not found. Please ensure ffmpeg-static is installed.'));
        return;
      }
      const ffmpegProcess = spawn(ffmpegPath, args);

      let errorOutput = '';

      ffmpegProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          resolve(outputVideo);
        } else {
          reject(
            new Error(`FFmpeg processing failed with code ${code}: ${errorOutput}`)
          );
        }
      });

      ffmpegProcess.on('error', (error) => {
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });
    });
  }

  /**
   * Create FFmpeg filter complex for cursor overlay
   * Uses a data file approach for frame-by-frame positioning
   */
  private createCursorOverlayFilter(
    events: MouseEvent[],
    cursorImagePath: string,
    cursorSize: number,
    frameRate: number
  ): string {
    if (events.length === 0) {
      return '[0:v]copy[out]';
    }

    // Create a simpler approach: use linear interpolation expression
    // For better performance, we'll sample keyframes and interpolate
    const keyframeInterval = Math.max(1, Math.floor(events.length / 100)); // Sample ~100 keyframes
    const keyframes: Array<{ time: number; x: number; y: number }> = [];

    for (let i = 0; i < events.length; i += keyframeInterval) {
      const event = events[i];
      keyframes.push({
        time: event.timestamp / 1000,
        x: Math.max(0, event.x - cursorSize / 2),
        y: Math.max(0, event.y - cursorSize / 2),
      });
    }

    // Add last frame
    const lastEvent = events[events.length - 1];
    if (keyframes[keyframes.length - 1]?.time !== lastEvent.timestamp / 1000) {
      keyframes.push({
        time: lastEvent.timestamp / 1000,
        x: Math.max(0, lastEvent.x - cursorSize / 2),
        y: Math.max(0, lastEvent.y - cursorSize / 2),
      });
    }

    // Build simpler expression using keyframes
    // Use piecewise linear interpolation
    let xExpression = keyframes[0].x.toString();
    let yExpression = keyframes[0].y.toString();

    for (let i = 1; i < keyframes.length; i++) {
      const prev = keyframes[i - 1];
      const curr = keyframes[i];
      const timeDiff = curr.time - prev.time;

      if (timeDiff > 0) {
        // Linear interpolation: x = x0 + (x1 - x0) * (t - t0) / (t1 - t0)
        const xSlope = (curr.x - prev.x) / timeDiff;
        const ySlope = (curr.y - prev.y) / timeDiff;
        
        xExpression += `+(${xSlope})*max(0,min(${timeDiff},t-${prev.time}))`;
        yExpression += `+(${ySlope})*max(0,min(${timeDiff},t-${prev.time}))`;
      }
    }

    // Create overlay filter with dynamic positioning
    // Scale cursor image to desired size first, then overlay
    return `[1:v]scale=${cursorSize}:${cursorSize}[cursor];[0:v][cursor]overlay=x='${xExpression}':y='${yExpression}'[out]`;
  }

  /**
   * Ensure cursor is available as PNG
   * Uses FFmpeg to convert SVG to PNG if needed
   */
  private async ensureCursorPNG(
    svgPath: string,
    size: number
  ): Promise<string> {
    const pngPath = svgPath.replace('.svg', '.png');

    if (existsSync(pngPath)) {
      return pngPath;
    }

    // Use FFmpeg to convert SVG to PNG
    try {
      const args = [
        '-i',
        svgPath,
        '-vf',
        `scale=${size}:${size}`,
        '-frames:v',
        '1',
        '-y',
        pngPath,
      ];

      await new Promise<void>((resolve, reject) => {
        // Use ffmpeg-static to get the bundled ffmpeg binary path
        const ffmpegPath = ffmpegStatic || 'ffmpeg';
        if (!ffmpegPath) {
          reject(new Error('FFmpeg binary not found. Please ensure ffmpeg-static is installed.'));
          return;
        }
        const ffmpegProcess = spawn(ffmpegPath, args);
        let errorOutput = '';

        ffmpegProcess.stderr?.on('data', (data) => {
          errorOutput += data.toString();
        });

        ffmpegProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`FFmpeg conversion failed: ${errorOutput}`));
          }
        });

        ffmpegProcess.on('error', (error) => {
          reject(error);
        });
      });

      return pngPath;
    } catch (error) {
      // If FFmpeg conversion fails, try alternative method
      try {
        const { convertSVGToPNG } = await import('./cursor-renderer');
        await convertSVGToPNG(svgPath, pngPath, size);
        return pngPath;
      } catch (error2) {
        // Last resort: return SVG and hope FFmpeg can handle it
        console.warn('Could not convert SVG to PNG, using SVG directly');
        return svgPath;
      }
    }
  }

  /**
   * Alternative: Generate cursor overlay using drawtext/drawbox
   * This is simpler but less flexible
   */
  private createSimpleCursorOverlay(
    events: MouseEvent[],
    frameRate: number
  ): string {
    // This would use drawtext or similar to draw cursor
    // For now, we'll use the overlay approach
    return '';
  }
}

