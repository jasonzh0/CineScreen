import { existsSync, statSync } from 'fs';
import { spawn } from 'child_process';
import { getFfmpegPath } from './ffmpeg-path';
import { createLogger } from './logger';

const logger = createLogger('FileUtils');

/**
 * Wait for a file to be finalized (file size stabilizes)
 * @param filePath Path to the file
 * @param maxWaitMs Maximum time to wait in milliseconds
 * @param checkIntervalMs Interval between checks in milliseconds
 * @returns Promise that resolves when file is stable or timeout
 */
export async function waitForFileStable(
  filePath: string,
  maxWaitMs: number = 2000,
  checkIntervalMs: number = 100
): Promise<void> {
  let lastSize = 0;
  let stableCount = 0;
  const requiredStableChecks = 3; // File must be stable for 3 consecutive checks
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkFile = () => {
      const elapsed = Date.now() - startTime;
      
      if (elapsed > maxWaitMs) {
        // Timeout - resolve anyway (file might still be valid)
        resolve();
        return;
      }

      if (!existsSync(filePath)) {
        // File doesn't exist yet, keep waiting
        setTimeout(checkFile, checkIntervalMs);
        return;
      }

      try {
        const stats = statSync(filePath);
        const currentSize = stats.size;

        if (currentSize === lastSize) {
          stableCount++;
          if (stableCount >= requiredStableChecks) {
            // File size has been stable, it's likely finalized
            resolve();
            return;
          }
        } else {
          // Size changed, reset stable count
          stableCount = 0;
          lastSize = currentSize;
        }

        // Continue checking
        setTimeout(checkFile, checkIntervalMs);
      } catch (error) {
        // Error accessing file, keep trying
        setTimeout(checkFile, checkIntervalMs);
      }
    };

    checkFile();
  });
}

/**
 * Validate that a video file is complete and can be read by FFmpeg
 * Works with any video format (MKV, MP4, MOV, etc.)
 * @param filePath Path to the video file
 * @param maxRetries Maximum number of retry attempts
 * @param retryDelayMs Delay between retries in milliseconds
 * @returns Promise that resolves if file is valid, rejects if invalid
 */
export async function validateVideoFile(
  filePath: string,
  maxRetries: number = 5,
  retryDelayMs: number = 500
): Promise<void> {

  if (!existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (stats.size === 0) {
    throw new Error(`File is empty: ${filePath}`);
  }

  // Retry validation multiple times as the file might still be finalizing
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const isValid = await new Promise<boolean>((resolve) => {
        try {
          const ffmpegPath = getFfmpegPath();
          // Use ffprobe-like command to check if file is readable
          // This works for any video format (MKV, MP4, MOV, etc.)
          const probeProcess = spawn(ffmpegPath, [
            '-v', 'error',
            '-i', filePath,
            '-f', 'null',
            '-'
          ]);

          let errorOutput = '';
          let hasOutput = false;

          probeProcess.stderr?.on('data', (data) => {
            hasOutput = true;
            errorOutput += data.toString();
          });

          probeProcess.on('close', (code) => {
            if (code === 0) {
              resolve(true);
            } else {
              // Check for specific errors that indicate file is invalid
              const isInvalid = errorOutput.includes('moov atom not found') || 
                                errorOutput.includes('Invalid data found when processing input') ||
                                errorOutput.includes('No such file') ||
                                errorOutput.includes('Permission denied') ||
                                errorOutput.includes('End of file') ||
                                errorOutput.includes('Invalid argument');
              
              if (isInvalid) {
                logger.debug(`Video validation failed (attempt ${attempt}): ${errorOutput.substring(0, 300)}`);
                resolve(false);
              } else if (hasOutput) {
                // Has output but non-zero code - might be warnings, assume valid
                logger.debug(`FFmpeg probe warning (code ${code}, attempt ${attempt}): ${errorOutput.substring(0, 200)}`);
                resolve(true);
              } else {
                // No output and non-zero code - might be invalid
                logger.debug(`FFmpeg probe failed silently (code ${code}, attempt ${attempt})`);
                resolve(false);
              }
            }
          });

          probeProcess.on('error', (error) => {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.debug(`FFmpeg probe spawn error (attempt ${attempt}): ${errorMsg}`);
            resolve(false);
          });

          // Timeout after 3 seconds per attempt
          setTimeout(() => {
            if (!probeProcess.killed) {
              probeProcess.kill();
              logger.debug(`FFmpeg probe timeout (attempt ${attempt})`);
              resolve(false);
            }
          }, 3000);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.debug(`FFmpeg probe exception (attempt ${attempt}): ${errorMsg}`);
          resolve(false);
        }
      });

      if (isValid) {
        logger.debug(`Video file validated successfully on attempt ${attempt}: ${filePath}`);
        return;
      } else {
        if (attempt < maxRetries) {
          logger.debug(`Video file validation failed on attempt ${attempt}, retrying in ${retryDelayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        } else {
          throw new Error(
            `Video file is incomplete after ${maxRetries} validation attempts: ${filePath}. ` +
            `The file may not have been finalized properly.`
          );
        }
      }
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
}

/**
 * @deprecated Use validateVideoFile instead. This function is kept for backwards compatibility.
 */
export async function validateMp4File(
  filePath: string,
  maxRetries: number = 5,
  retryDelayMs: number = 500
): Promise<void> {
  return validateVideoFile(filePath, maxRetries, retryDelayMs);
}

