import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { RecordingConfig } from '../types';
import { getFfmpegPath } from '../utils/ffmpeg-path';
import { waitForFileStable, validateVideoFile } from '../utils/file-utils';
import { createLogger } from '../utils/logger';
import { DEFAULT_FRAME_RATE } from '../utils/constants';

// Create logger for screen capture
const logger = createLogger('ScreenCapture');

export class ScreenCapture {
  private recordingProcess?: ChildProcess;
  private outputPath: string = '';
  private isRecording = false;

  /**
   * Find the screen device index by listing avfoundation devices
   * @returns The screen device index, or null if not found
   */
  private async findScreenDeviceIndex(): Promise<number | null> {
    return new Promise((resolve) => {
      let resolvedFfmpegPath: string;
      try {
        resolvedFfmpegPath = getFfmpegPath();
      } catch (error) {
        logger.error('Error in path resolution for device listing:', error);
        resolve(null);
        return;
      }

      const listProcess = spawn(resolvedFfmpegPath, [
        '-f', 'avfoundation',
        '-list_devices', 'true',
        '-i', ''
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      listProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      listProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      listProcess.on('close', () => {
        // Combine both outputs as FFmpeg may output to either
        const combinedOutput = output + errorOutput;
        logger.debug('Device list output:', combinedOutput);

        // Look for screen devices - they're typically listed as "Capture screen" or similar
        // Pattern: [AVFoundation input device @ 0x...] [index] Capture screen ...
        const screenMatch = combinedOutput.match(/\[(\d+)\]\s+Capture screen/i);
        if (screenMatch) {
          const deviceIndex = parseInt(screenMatch[1], 10);
          logger.debug('Found screen device at index:', deviceIndex);
          resolve(deviceIndex);
          return;
        }

        // Fallback: look for any device that mentions "screen" (case insensitive)
        const screenPattern = /\[(\d+)\].*screen/i;
        const fallbackMatch = combinedOutput.match(screenPattern);
        if (fallbackMatch) {
          const deviceIndex = parseInt(fallbackMatch[1], 10);
          logger.debug('Found screen device (fallback) at index:', deviceIndex);
          resolve(deviceIndex);
          return;
        }

        // If no screen found, default to index 1 (common default for main display)
        logger.debug('No screen device found in list, defaulting to index 1');
        resolve(1);
      });

      listProcess.on('error', (error) => {
        logger.error('Error listing devices:', error);
        // Default to index 1 if listing fails
        resolve(1);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!listProcess.killed) {
          listProcess.kill();
          logger.debug('Device listing timeout, defaulting to index 1');
          resolve(1);
        }
      }, 5000);
    });
  }

  /**
   * Start screen recording using ffmpeg
   * Note: This uses the system's screen capture, which on macOS can be done via avfoundation
   */
  async startRecording(config: RecordingConfig): Promise<void> {
    logger.info('startRecording called with config:', config);
    
    if (this.isRecording) {
      logger.error('Recording already in progress, rejecting');
      throw new Error('Recording is already in progress');
    }

    this.outputPath = config.outputPath;
    this.isRecording = true;
    logger.debug('Output path set to:', this.outputPath);

    // Ensure output directory exists
    const outputDir = join(this.outputPath, '..');
    logger.debug('Output directory:', outputDir);
    if (!existsSync(outputDir)) {
      logger.debug('Creating output directory:', outputDir);
      mkdirSync(outputDir, { recursive: true });
    }

    // Find the screen device index (not camera)
    const screenDeviceIndex = await this.findScreenDeviceIndex();
    if (screenDeviceIndex === null) {
      throw new Error('Could not find screen capture device');
    }
    logger.debug('Using screen device index:', screenDeviceIndex);

    // Use ffmpeg with avfoundation to capture screen (not camera)
    // Note: This requires screen recording permission
    // Use MKV format (Matroska) which is more forgiving for interrupted recordings
    // MKV doesn't require moov atom at the beginning, making it more reliable
    // avfoundation outputs uyvy422, which libx264 will automatically convert to yuv420p
    // -capture_cursor 0: Hide cursor during recording (we'll overlay it later)
    const args = [
      '-f', 'avfoundation',
      '-framerate', String(config.frameRate || DEFAULT_FRAME_RATE),
      '-capture_cursor', '0', // Hide cursor - we'll overlay a smooth cursor SVG later
      '-i', `${screenDeviceIndex}:0`, // Screen input (detected index) with no audio (0)
      '-an', // Explicitly disable audio encoding to prevent audio stream issues
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', this.getCrfValue(config.quality || 'medium'),
      '-pix_fmt', 'yuv420p', // Output format (libx264 will convert from uyvy422)
      this.outputPath,
    ];
    logger.debug('FFmpeg args:', args);

    // If region is specified, add crop filter
    if (config.region) {
      const { x, y, width, height } = config.region;
      const cropIndex = args.indexOf('-c:v');
      args.splice(cropIndex, 0, 
        '-vf', `crop=${width}:${height}:${x}:${y}`
      );
    }

    return new Promise((resolve, reject) => {
      let resolvedFfmpegPath: string;
      try {
        // Get the resolved FFmpeg path using the utility function
        resolvedFfmpegPath = getFfmpegPath();
      } catch (error) {
        logger.error('Error in path resolution:', error);
        reject(new Error(`Error accessing FFmpeg binary: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      
      // Spawn FFmpeg process
      logger.debug('Spawning FFmpeg process with path:', resolvedFfmpegPath);
      logger.debug('Command:', resolvedFfmpegPath, args.join(' '));
      
      this.recordingProcess = spawn(resolvedFfmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      logger.debug('FFmpeg process spawned, PID:', this.recordingProcess.pid);

      this.recordingProcess.on('error', (error) => {
        logger.error('FFmpeg process error:', error);
        this.isRecording = false;
        reject(new Error(`Failed to start recording: ${error.message}`));
      });

      this.recordingProcess.stderr?.on('data', (data) => {
        // FFmpeg outputs to stderr
        const output = data.toString();
        logger.debug('FFmpeg stderr:', output.substring(0, 200)); // Log first 200 chars
        if (output.includes('frame=')) {
          // Recording started successfully
          logger.info('Recording started successfully (frame detected)');
          resolve();
        }
      });

      this.recordingProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        logger.debug('FFmpeg stdout:', output.substring(0, 200));
      });

      // Give it a moment to start
      setTimeout(() => {
        if (this.isRecording) {
          logger.debug('Recording started (timeout fallback)');
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Stop screen recording
   */
  async stopRecording(): Promise<string> {
    logger.info('stopRecording called');
    
    if (!this.isRecording || !this.recordingProcess) {
      logger.error('No recording in progress');
      throw new Error('No recording in progress');
    }

    return new Promise((resolve, reject) => {
      logger.info('Stopping FFmpeg recording...');
      // Use SIGINT as the primary shutdown mechanism
      // SIGINT (Ctrl+C) is reliable for non-interactive processes
      if (this.recordingProcess) {
        try {
          this.recordingProcess.kill('SIGINT');
          logger.debug('Sent SIGINT to FFmpeg');
        } catch (error) {
          logger.warn('Could not send SIGINT:', error);
        }
      }

      let isResolved = false;
      
      this.recordingProcess?.on('close', async (code) => {
        if (isResolved) return; // Prevent double resolution
        
        logger.debug('FFmpeg process closed with code:', code);
        this.isRecording = false;
        this.recordingProcess = undefined;
        
        // Code 0 = success, null = killed, 255 = killed by signal
        // For MKV format, even if killed, the file might be usable (MKV is more forgiving)
        const isGraceful = code === 0;
        const wasKilled = code === 255 || code === null;
        
        if (isGraceful || wasKilled) {
          logger.info(`Recording stopped (graceful: ${isGraceful}, killed: ${wasKilled}), waiting for file to be finalized...`);
          
          try {
            // Give FFmpeg a moment to flush buffers to disk (longer if killed)
            // Wait 2-5 seconds for buffers to flush after close event
            await new Promise(resolve => setTimeout(resolve, wasKilled ? 5000 : 2000));
            
            // Wait for file to stabilize (FFmpeg might still be writing)
            // Wait up to 10 seconds for file to stabilize
            // MKV format is more forgiving, but we still want to ensure it's finalized
            await waitForFileStable(this.outputPath, wasKilled ? 10000 : 5000, 100);
            logger.debug('File size stabilized, validating video file...');
            
            // Validate the video file is complete with retries
            // This will throw if the file is still invalid after all retries
            // Increased retry interval to 1000ms to give file system more time
            await validateVideoFile(this.outputPath, 5, 1000);
            logger.info('Video file validated successfully, output:', this.outputPath);
            isResolved = true;
            resolve(this.outputPath);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorDetails = error instanceof Error ? error.stack : JSON.stringify(error);
            logger.error('Error validating file after retries:', errorMessage);
            logger.debug('Error details:', errorDetails);
            
            // If file was killed but we can't validate it, still try to proceed
            // (MKV format is more forgiving and might be partially readable)
            if (wasKilled) {
              logger.warn('File was force-killed and validation failed, but proceeding with output path');
              logger.debug('File path:', this.outputPath);
              isResolved = true;
              resolve(this.outputPath);
            } else {
              // Don't proceed with an invalid file from graceful shutdown
              reject(new Error(
                `Failed to finalize recording: ${errorMessage}. ` +
                `The video file may be incomplete.`
              ));
            }
          }
        } else {
          logger.error('Recording stopped with error code:', code);
          reject(new Error(`Recording stopped with error code ${code}`));
        }
      });

      // Force kill after timeout if it doesn't stop gracefully
      setTimeout(() => {
        if (this.recordingProcess && !isResolved) {
          logger.warn('Force killing FFmpeg process (timeout)');
          this.recordingProcess.kill('SIGTERM'); // Try SIGTERM first (more graceful)
          
          // If still running after 30 more seconds, use SIGKILL
          setTimeout(() => {
            if (this.recordingProcess && !isResolved) {
              logger.warn('Force killing FFmpeg process with SIGKILL');
              this.recordingProcess.kill('SIGKILL');
            }
          }, 30000);
        }
      }, 60000); // Timeout to 60 seconds to allow FFmpeg to finish writing
    });
  }

  /**
   * Get CRF value based on quality setting
   */
  private getCrfValue(quality: 'low' | 'medium' | 'high'): string {
    switch (quality) {
      case 'low':
        return '28';
      case 'medium':
        return '23';
      case 'high':
        return '18';
      default:
        return '23';
    }
  }

  /**
   * Check if currently recording
   */
  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }
}

