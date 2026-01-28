/**
 * Recording-related IPC handlers for start/stop recording
 */

import { app, ipcMain, BrowserWindow } from 'electron';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import type { Platform } from '../../platform';
import type { RecordingConfig, CursorConfig, ZoomConfig, MouseEffectsConfig } from '../../types';
import { MetadataExporter } from '../../processing/metadata-exporter';
import { createLogger } from '../../utils/logger';
import { DEFAULT_FRAME_RATE, DEFAULT_CURSOR_SIZE } from '../../utils/constants';
import {
  getRecordingState,
  getCurrentRecordingConfig,
  setRecordingState,
  setCurrentRecordingConfig,
  getScreenCapture,
  getMouseTracker,
  createScreenCapture,
  createMouseTracker,
} from '../state';
import { showRecordingBar, hideRecordingBar, stopRecordingBarTimer } from '../recording-bar-window';

const logger = createLogger('IPC:Recording');

/**
 * Register recording-related IPC handlers
 * @param initPlatform - Function to initialize/get platform instance
 * @param getMainWindow - Function to get main window
 */
export function registerRecordingHandlers(
  initPlatform: () => Promise<Platform>,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('start-recording', async (_, config: RecordingConfig) => {
    logger.info('IPC: start-recording called with config:', config);
    const recordingState = getRecordingState();

    if (recordingState.isRecording) {
      logger.error('Recording already in progress');
      throw new Error('Recording is already in progress');
    }

    // Initialize platform
    const platform = await initPlatform();

    // Check permissions first (microphone is optional - only needed for audio recording)
    logger.debug('Checking permissions...');
    const permissions = platform.permissions.getDetailedStatus();
    logger.debug('Permissions check result:', permissions);
    if (permissions.screenRecording.state !== 'granted' || permissions.accessibility.state !== 'granted') {
      logger.error('Required permissions not granted');
      throw new Error('Required permissions not granted. Please grant Screen Recording and Accessibility permissions.');
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
    logger.debug('Temp video path:', tempVideoPath);
    logger.debug('Temp mouse data path:', tempMouseDataPath);

    setRecordingState({
      isRecording: true,
      startTime: Date.now(),
      tempVideoPath,
      tempMouseDataPath,
      outputPath: config.outputPath,
    });
    setCurrentRecordingConfig(config);

    const mainWindow = getMainWindow();

    try {
      // Hide the app window from screen capture to prevent it from appearing in recordings
      if (mainWindow) {
        logger.info('Enabling content protection to hide app from recording...');
        mainWindow.setContentProtection(true);
      }

      // Hide system cursor FIRST before anything else
      // This ensures the cursor is fully hidden before FFmpeg starts capturing
      logger.info('Hiding system cursor...');
      await platform.cursor.hide();

      // Add extra buffer time after cursor hide to ensure it's fully processed
      // This helps prevent the cursor from briefly appearing at the start of recording
      await new Promise(resolve => setTimeout(resolve, 100));

      // Start mouse tracking
      logger.info('Starting mouse tracking...');
      const mouseTrackingStartTime = Date.now();
      await mouseTracker.startTracking();
      logger.info('Mouse tracking started');

      // Start screen recording
      logger.info('Starting screen recording...');
      await screenCapture.startRecording({
        ...config,
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

      // Hide main window and show recording bar
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      showRecordingBar(getRecordingState().startTime || Date.now());

      return { success: true };
    } catch (error) {
      logger.error('Error starting recording:', error);
      setRecordingState({ isRecording: false });
      mouseTracker?.stopTracking();
      // Make sure cursor is visible if recording fails
      await platform.cursor.show();
      // Disable content protection if recording failed
      if (mainWindow) {
        mainWindow.setContentProtection(false);
      }
      throw error;
    }
  });

  ipcMain.handle('stop-recording', async (_, config: {
    cursorConfig?: CursorConfig;
    zoomConfig?: ZoomConfig;
    mouseEffectsConfig?: MouseEffectsConfig;
  } | CursorConfig) => {
    // Handle both old format (just CursorConfig) and new format (object with cursorConfig)
    let cursorConfig: CursorConfig = {
      size: DEFAULT_CURSOR_SIZE,
      shape: 'arrow',
    };
    let zoomConfig: ZoomConfig | undefined;
    let mouseEffectsConfig: MouseEffectsConfig | undefined;

    if (config && 'cursorConfig' in config) {
      // New format
      if (config.cursorConfig) {
        cursorConfig = config.cursorConfig;
      }
      zoomConfig = config.zoomConfig;
      mouseEffectsConfig = config.mouseEffectsConfig;
    } else if (config && 'size' in config) {
      // Old format - just CursorConfig
      cursorConfig = config as CursorConfig;
    }

    logger.info('IPC: stop-recording called with config:', { cursorConfig, zoomConfig, mouseEffectsConfig });

    const recordingState = getRecordingState();
    if (!recordingState.isRecording) {
      logger.error('No recording in progress');
      throw new Error('No recording in progress');
    }

    // Stop the timer immediately so UI shows recording has ended
    stopRecordingBarTimer();

    const mainWindow = getMainWindow();
    const screenCapture = getScreenCapture();
    const mouseTracker = getMouseTracker();
    const currentRecordingConfig = getCurrentRecordingConfig();

    try {
      // Initialize platform
      const platform = await initPlatform();

      // Stop screen recording
      logger.info('Stopping screen recording...');
      const videoPath = await screenCapture?.stopRecording();
      logger.info('Screen recording stopped, video path:', videoPath);

      // Show system cursor again
      logger.info('Showing system cursor...');
      await platform.cursor.ensureVisible();

      // Hide recording bar and show main window
      hideRecordingBar();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }

      // Disable content protection so window is visible again
      if (mainWindow) {
        logger.info('Disabling content protection...');
        mainWindow.setContentProtection(false);
      }

      if (!videoPath) {
        throw new Error('Failed to stop recording');
      }

      // Stop mouse tracking
      logger.info('Stopping mouse tracking...');
      mouseTracker?.stopTracking();
      logger.info('Mouse tracking stopped');

      // Save mouse data
      if (mouseTracker && recordingState.tempMouseDataPath) {
        logger.debug('Saving mouse data to:', recordingState.tempMouseDataPath);
        mouseTracker.saveToFile(recordingState.tempMouseDataPath);
      }

      // Get mouse events
      const mouseEvents = mouseTracker?.getEvents() || [];
      logger.debug('Mouse events count:', mouseEvents.length);
      const recordingDuration = Date.now() - (recordingState.startTime || 0);
      logger.debug('Recording duration:', recordingDuration, 'ms');

      // Determine final output path
      const finalOutputPath =
        recordingState.outputPath ||
        join(app.getPath('downloads'), `recording_${Date.now()}.mp4`);
      logger.debug('Final output path:', finalOutputPath);

      // Ensure output directory exists
      const outputDir = dirname(finalOutputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Copy video to final location (preserve original extension or use .mkv)
      const videoExtension = videoPath.split('.').pop() || 'mkv';
      const finalVideoPath = finalOutputPath.replace(/\.(mp4|mov|mkv|avi|webm)$/i, `.${videoExtension}`);

      logger.info('Copying video to final location:', finalVideoPath);
      copyFileSync(videoPath, finalVideoPath);
      logger.info('Video copied successfully');

      // Export metadata alongside the final video
      logger.info('Exporting metadata...');

      // Get screen dimensions for coordinate conversion (handles Retina displays)
      let screenDimensions: { width: number; height: number } | undefined;
      try {
        const { getScreenDimensions } = await import('../../processing/video-utils');
        screenDimensions = await getScreenDimensions();
        logger.debug('Screen dimensions for metadata export:', screenDimensions);
      } catch (error) {
        logger.warn('Could not get screen dimensions for metadata export:', error);
      }

      const exporter = new MetadataExporter();
      // Apply mouse-to-video timing offset to sync cursor with video
      const mouseToVideoOffset = recordingState.mouseToVideoOffset || 0;
      logger.debug(`Applying mouse-to-video offset: ${mouseToVideoOffset}ms to ${mouseEvents.length} events`);
      const adjustedMouseEvents = mouseEvents.map(event => ({
        ...event,
        timestamp: Math.max(0, event.timestamp - mouseToVideoOffset),
      }));

      const metadataPath = await exporter.exportMetadata({
        videoPath: finalVideoPath, // Use final video path so metadata is saved alongside it
        mouseEvents: adjustedMouseEvents,
        cursorConfig,
        zoomConfig,
        mouseEffectsConfig,
        frameRate: DEFAULT_FRAME_RATE,
        videoDuration: recordingDuration,
        screenDimensions,
        recordingRegion: currentRecordingConfig?.region,
      });

      logger.info('Metadata exported successfully to:', metadataPath);

      setRecordingState({
        isRecording: false,
        tempVideoPath: videoPath,
        metadataPath,
      });

      logger.info('Recording completed successfully');
      return {
        success: true,
        outputPath: finalVideoPath, // Return final video path
        metadataPath, // Return metadata path (saved alongside video)
      };
    } catch (error) {
      logger.error('Error processing recording:', error);
      setRecordingState({ isRecording: false });
      // Ensure content protection is disabled even on error
      if (mainWindow) {
        mainWindow.setContentProtection(false);
      }
      throw error;
    }
  });

  ipcMain.handle('get-recording-state', () => {
    return getRecordingState();
  });
}
