/**
 * Recording state management for main process
 * Centralized state for recording, screen capture, and mouse tracking
 */

import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { ScreenCapture } from '../screen-capture';
import { MouseTracker } from '../mouse-tracker';
import type { RecordingConfig, RecordingState } from '../../types';
import type { Platform } from '../../platform';
import { createLogger } from '../../utils/logger';
import { showRecordingBarIdle } from '../recording-bar-window';
import { getConfigValue, setConfigValue } from './config-store';

const logger = createLogger('RecordingState');

// Recording state
let recordingState: RecordingState = {
  isRecording: false,
};
let currentRecordingConfig: RecordingConfig | null = null;
let configuredOutputDir: string | null | undefined = undefined;

// Components
let screenCapture: ScreenCapture | null = null;
let mouseTracker: MouseTracker | null = null;

// Getters
export function getRecordingState(): RecordingState {
  return recordingState;
}

export function getCurrentRecordingConfig(): RecordingConfig | null {
  return currentRecordingConfig;
}

export function getConfiguredOutputDir(): string | null {
  if (configuredOutputDir === undefined) {
    configuredOutputDir = getConfigValue('outputDir');
  }
  return configuredOutputDir;
}

export function getConfiguredOutputPath(): string | null {
  const dir = getConfiguredOutputDir();
  return dir ? join(dir, `recording_${Date.now()}.mp4`) : null;
}

export function getScreenCapture(): ScreenCapture | null {
  return screenCapture;
}

export function getMouseTracker(): MouseTracker | null {
  return mouseTracker;
}

// Setters
export function setRecordingState(state: RecordingState): void {
  recordingState = state;
}

export function setCurrentRecordingConfig(config: RecordingConfig | null): void {
  currentRecordingConfig = config;
}

export function setConfiguredOutputDir(dir: string | null): void {
  configuredOutputDir = dir;
  setConfigValue('outputDir', dir);
}

// Create new instances
export function createScreenCapture(): ScreenCapture {
  screenCapture = new ScreenCapture();
  return screenCapture;
}

export function createMouseTracker(): MouseTracker {
  mouseTracker = new MouseTracker();
  return mouseTracker;
}

/**
 * Cleanup recording state without saving
 * @param platform - Platform instance for cursor management
 * @param mainWindow - Main window for content protection
 * @param saveFiles - Whether to preserve temp files
 */
export async function cleanupRecording(
  platform: Platform,
  mainWindow: Electron.BrowserWindow | null,
  saveFiles: boolean = false
): Promise<void> {
  // Stop screen recording if active
  if (screenCapture) {
    try {
      await screenCapture.stopRecording();
    } catch (error) {
      logger.error('Error stopping screen capture during cleanup:', error);
    }
  }

  // Stop mouse tracking
  if (mouseTracker) {
    mouseTracker.stopTracking();
  }

  // Show system cursor
  await platform.cursor.ensureVisible();

  // Disable content protection on main window if it exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setContentProtection(false);
  }

  // Show recording bar in idle mode
  showRecordingBarIdle();

  // Delete temp files if not saving
  if (!saveFiles) {
    if (recordingState.tempVideoPath && existsSync(recordingState.tempVideoPath)) {
      try {
        unlinkSync(recordingState.tempVideoPath);
        logger.info('Deleted temp video file');
      } catch (error) {
        logger.error('Error deleting temp video:', error);
      }
    }
    if (recordingState.tempMouseDataPath && existsSync(recordingState.tempMouseDataPath)) {
      try {
        unlinkSync(recordingState.tempMouseDataPath);
        logger.info('Deleted temp mouse data file');
      } catch (error) {
        logger.error('Error deleting temp mouse data:', error);
      }
    }
  }

  // Reset state
  recordingState = { isRecording: false };
  screenCapture = null;
  mouseTracker = null;
}
