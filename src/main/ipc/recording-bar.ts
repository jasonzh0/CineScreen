/**
 * Recording bar IPC handlers
 */

import { app, ipcMain, BrowserWindow } from 'electron';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import type { Platform } from '../../platform';
import type { CursorConfig, ZoomConfig } from '../../types';
import { MetadataExporter } from '../../processing/metadata-exporter';
import { createLogger } from '../../utils/logger';
import {
  getRecordingState,
  getCurrentRecordingConfig,
  getConfiguredOutputPath,
  setRecordingState,
  setCurrentRecordingConfig,
  getScreenCapture,
  getMouseTracker,
  createScreenCapture,
  createMouseTracker,
  cleanupRecording,
  loadConfig,
} from '../state';
import {
  showRecordingBar,
  hideRecordingBar,
  stopRecordingBarTimer,
  showRecordingBarIdle,
} from '../recording-bar-window';

const logger = createLogger('IPC:RecordingBar');

/**
 * Register recording bar IPC handlers
 * @param initPlatform - Function to initialize/get platform instance
 * @param getMainWindow - Function to get main window
 * @param createWindow - Function to create main window
 */
export function registerRecordingBarHandlers(
  initPlatform: () => Promise<Platform>,
  getMainWindow: () => BrowserWindow | null,
  createWindow: () => void
): void {
  // Stop recording from recording bar (same as normal stop)
  ipcMain.handle('recording-bar-stop', async () => {
    logger.info('IPC: recording-bar-stop called');

    const recordingState = getRecordingState();
    if (!recordingState.isRecording) {
      logger.warn('No recording in progress');
      return;
    }

    // Stop the timer immediately so UI shows recording has ended
    stopRecordingBarTimer();

    // Load configs from persistent store
    const userConfig = loadConfig();

    const cursorConfig: CursorConfig = {
      size: userConfig.cursorSize,
      shape: userConfig.cursorShape as CursorConfig['shape'],
    };

    const zoomConfig: ZoomConfig = {
      enabled: userConfig.zoomEnabled,
      level: userConfig.zoomLevel,
      transitionSpeed: 300,
      padding: 0,
      followSpeed: 1.0,
    };

    const mainWindow = getMainWindow();
    const screenCapture = getScreenCapture();
    const mouseTracker = getMouseTracker();
    const currentRecordingConfig = getCurrentRecordingConfig();

    try {
      const platform = await initPlatform();

      // Stop screen recording
      logger.info('Stopping screen recording...');
      const videoPath = await screenCapture?.stopRecording();
      logger.info('Screen recording stopped, video path:', videoPath);

      // Show system cursor again
      logger.info('Showing system cursor...');
      await platform.cursor.ensureVisible();

      // Disable content protection on main window if it exists
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setContentProtection(false);
      }

      // Show recording bar in idle mode
      showRecordingBarIdle();

      if (!videoPath) {
        throw new Error('Failed to stop recording');
      }

      // Stop mouse tracking
      logger.info('Stopping mouse tracking...');
      mouseTracker?.stopTracking();

      // Save mouse data
      if (mouseTracker && recordingState.tempMouseDataPath) {
        mouseTracker.saveToFile(recordingState.tempMouseDataPath);
      }

      // Get mouse events
      const mouseEvents = mouseTracker?.getEvents() || [];
      const recordingDuration = Date.now() - (recordingState.startTime || 0);

      // Determine final output path
      const finalOutputPath =
        recordingState.outputPath ||
        join(app.getPath('downloads'), `recording_${Date.now()}.mp4`);

      // Ensure output directory exists
      const outputDir = dirname(finalOutputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Copy video to final location
      const videoExtension = videoPath.split('.').pop() || 'mkv';
      const finalVideoPath = finalOutputPath.replace(/\.(mp4|mov|mkv|avi|webm)$/i, `.${videoExtension}`);

      logger.info('Copying video to final location:', finalVideoPath);
      copyFileSync(videoPath, finalVideoPath);

      // Export metadata
      let screenDimensions: { width: number; height: number } | undefined;
      try {
        const { getScreenDimensions } = await import('../../processing/video-utils');
        screenDimensions = await getScreenDimensions();
      } catch (error) {
        logger.warn('Could not get screen dimensions:', error);
      }

      const exporter = new MetadataExporter();
      const mouseToVideoOffset = recordingState.mouseToVideoOffset || 0;
      const adjustedMouseEvents = mouseEvents.map(event => ({
        ...event,
        timestamp: Math.max(0, event.timestamp - mouseToVideoOffset),
      }));

      const metadataPath = await exporter.exportMetadata({
        videoPath: finalVideoPath,
        mouseEvents: adjustedMouseEvents,
        cursorConfig,
        zoomConfig,
        frameRate: parseInt(userConfig.frameRate, 10) || 60,
        videoDuration: recordingDuration,
        screenDimensions,
        recordingRegion: currentRecordingConfig?.region,
      });

      logger.info('Recording completed successfully');

      setRecordingState({
        isRecording: false,
        tempVideoPath: videoPath,
        metadataPath,
      });

      // Notify main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recording-completed', {
          success: true,
          outputPath: finalVideoPath,
          metadataPath,
        });
      }

      return { success: true, outputPath: finalVideoPath, metadataPath };
    } catch (error) {
      logger.error('Error stopping recording:', error);
      const platform = await initPlatform();
      await cleanupRecording(platform, mainWindow, false);
      throw error;
    }
  });

  // Restart recording from recording bar (cancel current and start new)
  ipcMain.handle('recording-bar-restart', async () => {
    logger.info('IPC: recording-bar-restart called');

    const recordingState = getRecordingState();
    if (!recordingState.isRecording) {
      logger.warn('No recording in progress to restart');
      return;
    }

    // Store the config for restarting
    const configToRestart = getCurrentRecordingConfig();

    // Cleanup without saving
    const platform = await initPlatform();
    const mainWindow = getMainWindow();
    await cleanupRecording(platform, mainWindow, false);

    // Start new recording if we have the config
    if (configToRestart) {
      // Short delay to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // Trigger new recording through main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('restart-recording', configToRestart);
      }
    }
  });

  // Cancel recording from recording bar (discard without saving)
  ipcMain.handle('recording-bar-cancel', async () => {
    logger.info('IPC: recording-bar-cancel called');

    const recordingState = getRecordingState();
    if (!recordingState.isRecording) {
      logger.warn('No recording in progress to cancel');
      return;
    }

    // Stop the timer immediately so UI shows recording has ended
    stopRecordingBarTimer();

    const platform = await initPlatform();
    const mainWindow = getMainWindow();
    await cleanupRecording(platform, mainWindow, false);
    logger.info('Recording cancelled and discarded');

    // Notify main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording-cancelled');
    }
  });

  // Open main window from recording bar menu
  ipcMain.handle('open-main-window', async () => {
    logger.info('IPC: open-main-window called');

    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Start recording from recording bar
  ipcMain.handle('recording-bar-start', async () => {
    logger.info('IPC: recording-bar-start called');

    const recordingState = getRecordingState();
    if (recordingState.isRecording) {
      logger.warn('Recording already in progress');
      return;
    }

    // Initialize platform
    const platform = await initPlatform();

    // Check permissions first
    logger.debug('Checking permissions...');
    const permissions = platform.permissions.getDetailedStatus();
    logger.debug('Permissions check result:', permissions);
    if (permissions.screenRecording.state !== 'granted' || permissions.accessibility.state !== 'granted') {
      logger.error('Required permissions not granted');
      // Open main window and show toast
      let mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
        mainWindow = getMainWindow();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
      // Wait for window to be ready then send toast
      const sendToast = () => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('show-toast', {
            message: 'Please grant Screen Recording and Accessibility permissions before recording',
            type: 'warning',
            switchTab: 'permissions',
          });
        }
      };
      if (mainWindow?.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', sendToast);
      } else {
        sendToast();
      }
      return { success: false, reason: 'permissions' };
    }

    // Check for output path
    const configuredOutputPath = getConfiguredOutputPath();
    if (!configuredOutputPath) {
      logger.error('Output path not configured');
      // Open main window and show toast
      let mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
        mainWindow = getMainWindow();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
      const sendToast = () => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('show-toast', {
            message: 'Please set an output path before recording',
            type: 'warning',
            switchTab: 'recording',
          });
        }
      };
      if (mainWindow?.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', sendToast);
      } else {
        sendToast();
      }
      return { success: false, reason: 'output-path' };
    }

    // Initialize components
    logger.info('Initializing screen capture and mouse tracker');
    const screenCapture = createScreenCapture();
    const mouseTracker = createMouseTracker();

    // Generate temp file paths
    const tempDir = join(app.getPath('temp'), 'screen-recorder');
    logger.debug('Temp directory:', tempDir);
    if (!existsSync(tempDir)) {
      logger.debug('Creating temp directory');
      mkdirSync(tempDir, { recursive: true });
    }

    const timestamp = Date.now();
    const tempVideoPath = join(tempDir, `recording_${timestamp}.mkv`);
    const tempMouseDataPath = join(tempDir, `mouse_${timestamp}.json`);

    setRecordingState({
      isRecording: true,
      startTime: Date.now(),
      tempVideoPath,
      tempMouseDataPath,
      outputPath: configuredOutputPath,
    });

    // Create recording config from persisted settings
    const userConfig = loadConfig();
    setCurrentRecordingConfig({
      outputPath: configuredOutputPath,
      frameRate: parseInt(userConfig.frameRate, 10) || 60,
    });

    const mainWindow = getMainWindow();

    try {
      // Hide the main window during recording
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setContentProtection(true);
        mainWindow.hide();
      }

      // Hide system cursor FIRST
      logger.info('Hiding system cursor...');
      await platform.cursor.hide();

      // Buffer time after cursor hide
      await new Promise(resolve => setTimeout(resolve, 100));

      // Start mouse tracking
      logger.info('Starting mouse tracking...');
      const mouseTrackingStartTime = Date.now();
      await mouseTracker.startTracking();
      logger.info('Mouse tracking started');

      // Start screen recording
      logger.info('Starting screen recording...');
      const currentConfig = getCurrentRecordingConfig();
      await screenCapture.startRecording({
        ...currentConfig!,
        outputPath: tempVideoPath,
      });
      const videoStartTime = Date.now();
      const mouseToVideoOffset = videoStartTime - mouseTrackingStartTime;

      const currentState = getRecordingState();
      setRecordingState({
        ...currentState,
        mouseToVideoOffset,
      });
      logger.info(`Screen recording started successfully. Mouse-to-video offset: ${mouseToVideoOffset}ms`);

      // Hide the recording bar completely during recording
      hideRecordingBar();

      return { success: true };
    } catch (error) {
      logger.error('Error starting recording from bar:', error);
      setRecordingState({ isRecording: false });
      mouseTracker?.stopTracking();
      await platform.cursor.show();
      if (mainWindow) {
        mainWindow.setContentProtection(false);
      }
      // Show recording bar again in idle mode on error
      showRecordingBarIdle();
      throw error;
    }
  });
}
