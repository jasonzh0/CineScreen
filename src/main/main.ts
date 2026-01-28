/**
 * Main process entry point
 * App lifecycle and initialization only - handlers are in separate modules
 */

import { app } from 'electron';
import { getPlatform } from '../platform';
import type { Platform } from '../platform';
import { createLogger } from '../utils/logger';
import { getMainWindow, createWindow } from './window-manager';
import { registerAllIpcHandlers } from './ipc';
import { getRecordingState } from './state';
import {
  showRecordingBar,
  showRecordingBarIdle,
  getRecordingBarWindow,
} from './recording-bar-window';

// Create logger for main process
const logger = createLogger('Main');

let platformInstance: Platform | null = null;

// Initialize platform on startup
async function initPlatform(): Promise<Platform> {
  if (!platformInstance) {
    platformInstance = await getPlatform();
  }
  return platformInstance;
}

// Register all IPC handlers
registerAllIpcHandlers(initPlatform, getMainWindow, createWindow);

app.whenReady().then(() => {
  logger.info('App ready, showing recording bar in idle mode');
  showRecordingBarIdle();

  app.on('activate', () => {
    // Show recording bar if no windows are visible
    const recordingBar = getRecordingBarWindow();
    const recordingState = getRecordingState();

    if (!recordingBar || recordingBar.isDestroyed()) {
      logger.info('App activated, showing recording bar');
      if (recordingState.isRecording) {
        showRecordingBar(recordingState.startTime || Date.now());
      } else {
        showRecordingBarIdle();
      }
    } else if (!recordingBar.isVisible()) {
      if (recordingState.isRecording) {
        showRecordingBar(recordingState.startTime || Date.now());
      } else {
        showRecordingBarIdle();
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Ensure cursor is visible when app quits (in case recording was interrupted)
// Use fire-and-forget with timeout to prevent blocking quit
app.on('before-quit', () => {
  logger.info('App quitting, ensuring cursor is visible...');
  // Only restore cursor if platform was already initialized (don't block on init during quit)
  if (platformInstance) {
    // Fire and forget - don't await, let the app quit
    Promise.race([
      platformInstance.cursor.ensureVisible(),
      new Promise(resolve => setTimeout(resolve, 500)), // 500ms timeout
    ]).catch(() => {
      // Ignore errors during quit
    });
  }
});
