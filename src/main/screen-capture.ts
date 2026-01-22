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

// Platform detection
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

export class ScreenCapture {
  private recordingProcess?: ChildProcess;
  private outputPath: string = '';
  private isRecording = false;

  /**
   * Find the screen device index by listing avfoundation devices (macOS only)
   * @returns The screen device index, or null if not found
   */
  private async findScreenDeviceIndex(): Promise<number | null> {
    if (!isMac) {
      // Windows uses gdigrab which doesn't need device enumeration
      return null;
    }

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
   * Build FFmpeg arguments for screen capture
   * Uses platform-specific input methods
   */
  private async buildRecordingArgs(config: RecordingConfig): Promise<string[]> {
    const frameRate = String(config.frameRate || DEFAULT_FRAME_RATE);

    if (isWindows) {
      // Windows: use gdigrab for desktop capture
      // gdigrab captures the entire desktop by default
      // -draw_mouse 0: Don't capture the cursor - we'll overlay our own animated cursor later
      const args = [
        '-f', 'gdigrab',
        '-framerate', frameRate,
        '-draw_mouse', '0',  // Hide cursor in recording
        '-i', 'desktop',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', this.getCrfValue(config.quality || 'medium'),
        '-pix_fmt', 'yuv420p',
      ];

      // Add crop filter for region capture
      if (config.region) {
        const { x, y, width, height } = config.region;
        // For gdigrab, we can specify offset and size in the input
        // Remove 'desktop' and add with offset
        args.splice(args.indexOf('desktop'), 1, 'desktop');
        // Add offset parameters before -i
        const iIndex = args.indexOf('-i');
        args.splice(iIndex, 0, '-offset_x', String(x), '-offset_y', String(y), '-video_size', `${width}x${height}`);
      }

      args.push(this.outputPath);
      return args;
    } else {
      // macOS: use avfoundation
      const screenDeviceIndex = await this.findScreenDeviceIndex();
      if (screenDeviceIndex === null) {
        throw new Error('Could not find screen capture device');
      }
      logger.debug('Using screen device index:', screenDeviceIndex);

      const args = [
        '-f', 'avfoundation',
        '-framerate', frameRate,
        '-capture_cursor', '0', // Hide cursor - we'll overlay a smooth cursor SVG later
        '-i', `${screenDeviceIndex}:0`, // Screen input (detected index) with no audio (0)
        '-an', // Explicitly disable audio encoding to prevent audio stream issues
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', this.getCrfValue(config.quality || 'medium'),
        '-pix_fmt', 'yuv420p',
      ];

      // Add crop filter for region capture
      if (config.region) {
        const { x, y, width, height } = config.region;
        const cropIndex = args.indexOf('-c:v');
        args.splice(cropIndex, 0, '-vf', `crop=${width}:${height}:${x}:${y}`);
      }

      args.push(this.outputPath);
      return args;
    }
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

    // Build platform-specific FFmpeg arguments
    const args = await this.buildRecordingArgs(config);
    logger.debug('FFmpeg args:', args);

    return new Promise((resolve, reject) => {
      let resolvedFfmpegPath: string;
      let isSettled = false;
      let stderrOutput = '';

      const safeResolve = () => {
        if (!isSettled) {
          isSettled = true;
          resolve();
        }
      };

      const safeReject = (error: Error) => {
        if (!isSettled) {
          isSettled = true;
          this.isRecording = false;
          reject(error);
        }
      };

      try {
        // Get the resolved FFmpeg path using the utility function
        resolvedFfmpegPath = getFfmpegPath();
      } catch (error) {
        logger.error('Error in path resolution:', error);
        safeReject(new Error(`Error accessing FFmpeg binary: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }

      // Spawn FFmpeg process
      logger.debug('Spawning FFmpeg process with path:', resolvedFfmpegPath);
      logger.debug('Command:', resolvedFfmpegPath, args.join(' '));

      // Enable stdin so we can send 'q' to gracefully quit FFmpeg
      this.recordingProcess = spawn(resolvedFfmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      logger.debug('FFmpeg process spawned, PID:', this.recordingProcess.pid);

      this.recordingProcess.on('error', (error) => {
        logger.error('FFmpeg process error:', error);
        safeReject(new Error(`Failed to start recording: ${error.message}`));
      });

      // Handle process exit during startup - this catches permission denials
      this.recordingProcess.on('close', (code) => {
        if (!isSettled) {
          logger.error('FFmpeg process exited during startup with code:', code);
          logger.error('FFmpeg stderr output:', stderrOutput);

          // Check for common error patterns
          let errorMessage = 'Screen recording failed to start';
          if (stderrOutput.includes('Could not create') || stderrOutput.includes('Permission denied')) {
            errorMessage = 'Screen recording permission denied. Please grant screen recording permission and try again.';
          } else if (stderrOutput.includes('Invalid device') || stderrOutput.includes('No such device')) {
            errorMessage = 'Screen capture device not found. Please check your display settings.';
          } else if (code !== 0) {
            errorMessage = `Screen recording failed (exit code ${code}). The screen recording permission dialog may have been dismissed.`;
          }

          safeReject(new Error(errorMessage));
        }
      });

      this.recordingProcess.stderr?.on('data', (data) => {
        // FFmpeg outputs to stderr
        const output = data.toString();
        stderrOutput += output; // Collect for error reporting
        logger.debug('FFmpeg stderr:', output.substring(0, 200)); // Log first 200 chars
        if (output.includes('frame=')) {
          // Recording started successfully
          logger.info('Recording started successfully (frame detected)');
          safeResolve();
        }
      });

      this.recordingProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        logger.debug('FFmpeg stdout:', output.substring(0, 200));
      });

      // Give it a moment to start, but only resolve if process is still running
      setTimeout(() => {
        if (!isSettled && this.isRecording && this.recordingProcess && !this.recordingProcess.killed) {
          // Check if process is actually still running
          if (this.recordingProcess.exitCode === null) {
            logger.debug('Recording started (timeout fallback)');
            safeResolve();
          } else {
            // Process already exited, the close handler should have rejected
            logger.warn('Timeout fired but process already exited');
          }
        }
      }, 1500); // Increased timeout to give more time for permission dialog
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

    // Store reference to process and output path before they might be cleared
    const process = this.recordingProcess;
    const outputPath = this.outputPath;
    let isResolved = false;

    return new Promise((resolve, reject) => {
      logger.info('Stopping FFmpeg recording...');

      // Declare timeout variables so they can be accessed in handlers
      let sigintTimeout: NodeJS.Timeout;
      let finalTimeout: NodeJS.Timeout;

      // Set up event handlers BEFORE sending signal to avoid race conditions
      const handleClose = async (code: number | null) => {
        if (isResolved) return; // Prevent double resolution

        // Clean up timeouts
        if (sigintTimeout) clearTimeout(sigintTimeout);
        if (finalTimeout) clearTimeout(finalTimeout);

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
            // Give FFmpeg more time to flush buffers to disk
            // Increased wait time to ensure all frames are written, especially for graceful shutdowns
            // Wait 3-6 seconds for buffers to flush after close event
            const flushWaitTime = wasKilled ? 6000 : 3000;
            logger.debug(`Waiting ${flushWaitTime}ms for FFmpeg to flush buffers...`);
            await new Promise(resolve => setTimeout(resolve, flushWaitTime));

            // Wait for file to stabilize (FFmpeg might still be writing)
            // Increased wait time to ensure all frames are written
            // Wait up to 15 seconds for file to stabilize
            await waitForFileStable(outputPath, wasKilled ? 15000 : 10000, 100);
            logger.debug('File size stabilized, validating video file...');

            // Validate the video file is complete with retries
            // This will throw if the file is still invalid after all retries
            // Increased retry interval to 1000ms to give file system more time
            await validateVideoFile(outputPath, 5, 1000);
            logger.info('Video file validated successfully, output:', outputPath);
            isResolved = true;
            resolve(outputPath);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorDetails = error instanceof Error ? error.stack : JSON.stringify(error);
            logger.error('Error validating file after retries:', errorMessage);
            logger.debug('Error details:', errorDetails);

            // If file was killed but we can't validate it, still try to proceed
            // (MKV format is more forgiving and might be partially readable)
            if (wasKilled) {
              logger.warn('File was force-killed and validation failed, but proceeding with output path');
              logger.debug('File path:', outputPath);
              isResolved = true;
              resolve(outputPath);
            } else {
              // Don't proceed with an invalid file from graceful shutdown
              isResolved = true;
              reject(new Error(
                `Failed to finalize recording: ${errorMessage}. ` +
                `The video file may be incomplete.`
              ));
            }
          }
        } else {
          logger.error('Recording stopped with error code:', code);
          isResolved = true;
          reject(new Error(`Recording stopped with error code ${code}`));
        }
      };

      const handleError = (error: Error) => {
        if (isResolved) return;
        logger.error('FFmpeg process error during stop:', error);
        // Don't reject here - let the close handler deal with it
        // But if process is already dead, we might need to handle it
        if (!process.killed) {
          logger.warn('Process error but still alive, attempting to kill');
          try {
            process.kill('SIGTERM');
          } catch (killError) {
            logger.error('Failed to kill process after error:', killError);
          }
        }
      };

      // Set up event handlers BEFORE checking process state
      // This ensures we catch the close event even if process is already closing
      process.once('close', handleClose);
      process.once('error', handleError);

      // Check if process is still alive before sending signal
      if (process.killed) {
        logger.warn('Process already killed, waiting for close event');
        // Process might already be closing, just wait for the close event
        // The close handler will resolve the promise
        // Set a timeout in case the close event never fires
        setTimeout(() => {
          if (!isResolved) {
            logger.warn('Process was killed but close event never fired, resolving anyway');
            this.isRecording = false;
            this.recordingProcess = undefined;
            isResolved = true;
            // Give file a moment to be written
            setTimeout(async () => {
              try {
                await waitForFileStable(outputPath, 5000, 100);
                resolve(outputPath);
              } catch (error) {
                logger.warn('File validation failed, but proceeding:', error);
                resolve(outputPath);
              }
            }, 2000);
          }
        }, 5000);
        return;
      }

      // Try to gracefully quit FFmpeg by sending 'q' to stdin first
      // This allows FFmpeg to flush all buffered frames before stopping
      if (process.stdin && !process.stdin.destroyed) {
        try {
          logger.debug('Sending quit command (q) to FFmpeg stdin to gracefully stop...');
          process.stdin.write('q\n');
          process.stdin.end();

          // Give FFmpeg time to process the quit command and flush buffers
          // Wait up to 3 seconds for graceful shutdown
          setTimeout(() => {
            if (process && !process.killed && !isResolved) {
              logger.warn('FFmpeg did not respond to quit command within 3 seconds, sending SIGINT');
              try {
                process.kill('SIGINT');
                logger.debug('Sent SIGINT to FFmpeg, PID:', process.pid);
              } catch (error) {
                logger.warn('Could not send SIGINT:', error);
                try {
                  process.kill('SIGTERM');
                  logger.debug('Sent SIGTERM to FFmpeg as fallback');
                } catch (termError) {
                  logger.error('Could not send SIGTERM either:', termError);
                }
              }
            }
          }, 3000);
        } catch (error) {
          logger.warn('Could not write to FFmpeg stdin, using SIGINT:', error);
          // Fall back to SIGINT if stdin write fails
          try {
            process.kill('SIGINT');
            logger.debug('Sent SIGINT to FFmpeg, PID:', process.pid);
          } catch (sigintError) {
            logger.warn('Could not send SIGINT:', sigintError);
            try {
              process.kill('SIGTERM');
              logger.debug('Sent SIGTERM to FFmpeg as fallback');
            } catch (termError) {
              logger.error('Could not send SIGTERM either:', termError);
            }
          }
        }
      } else {
        // Stdin not available, use SIGINT directly
        logger.debug('FFmpeg stdin not available, using SIGINT');
        try {
          process.kill('SIGINT');
          logger.debug('Sent SIGINT to FFmpeg, PID:', process.pid);
        } catch (error) {
          logger.warn('Could not send SIGINT:', error);
          try {
            process.kill('SIGTERM');
            logger.debug('Sent SIGTERM to FFmpeg as fallback');
          } catch (termError) {
            logger.error('Could not send SIGTERM either:', termError);
          }
        }
      }

      // Timeout for escalation: if FFmpeg doesn't respond to quit/SIGINT within 8 seconds, escalate to SIGTERM
      // This gives time for the 'q' command (3s) + SIGINT (5s) to work
      sigintTimeout = setTimeout(() => {
        if (process && !process.killed && !isResolved) {
          logger.warn('FFmpeg did not respond to quit/SIGINT within 8 seconds, trying SIGTERM');
          try {
            process.kill('SIGTERM');
          } catch (error) {
            logger.error('Could not send SIGTERM:', error);
          }
        }
      }, 8000);

      // Final timeout - force kill after 20 seconds total (increased to allow more time for graceful shutdown)
      finalTimeout = setTimeout(() => {
        if (process && !process.killed && !isResolved) {
          logger.warn('Force killing FFmpeg process with SIGKILL (final timeout)');
          try {
            process.kill('SIGKILL');
            // After SIGKILL, give it a moment then resolve anyway
            setTimeout(() => {
              if (!isResolved) {
                logger.warn('Process did not close after SIGKILL, resolving anyway');
                // Clean up and resolve with the file path
                this.isRecording = false;
                this.recordingProcess = undefined;
                isResolved = true;
                // Give file a moment to be written
                setTimeout(async () => {
                  try {
                    await waitForFileStable(outputPath, 5000, 100);
                    resolve(outputPath);
                  } catch (error) {
                    logger.warn('File validation failed after force kill, but proceeding:', error);
                    resolve(outputPath);
                  }
                }, 2000);
              }
            }, 2000);
          } catch (error) {
            logger.error('Could not send SIGKILL:', error);
            // Even if we can't kill it, resolve after a delay
            setTimeout(() => {
              if (!isResolved) {
                this.isRecording = false;
                this.recordingProcess = undefined;
                isResolved = true;
                resolve(outputPath);
              }
            }, 2000);
          }
        }
      }, 15000); // 15 seconds total timeout
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

