import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { ScreenCapture } from './screen-capture';
import { MouseTracker } from './mouse-tracker';
import { VideoProcessor } from '../processing/video-processor';
import { MetadataExporter } from '../processing/metadata-exporter';
import { createStudioWindow, getStudioWindow } from './studio-window';
import { showRecordingBar, hideRecordingBar, destroyRecordingBar, stopRecordingBarTimer, showRecordingBarIdle, getRecordingBarWindow } from './recording-bar-window';
import { getPlatform } from '../platform';
import type { Platform } from '../platform';
import type { RecordingConfig, CursorConfig, RecordingState, ZoomConfig, MouseEffectsConfig } from '../types';
import type { RecordingMetadata } from '../types/metadata';
import { createLogger, setLogSender } from '../utils/logger';
import { DEFAULT_FRAME_RATE, DEFAULT_CURSOR_SIZE } from '../utils/constants';

// Create logger for main process
const logger = createLogger('Main');

let mainWindow: BrowserWindow | null = null;
let screenCapture: ScreenCapture | null = null;
let mouseTracker: MouseTracker | null = null;
let recordingState: RecordingState = {
  isRecording: false,
};
let currentRecordingConfig: RecordingConfig | null = null;
let platformInstance: Platform | null = null;

const isDev = !app.isPackaged;

// Initialize platform on startup
async function initPlatform(): Promise<Platform> {
  if (!platformInstance) {
    platformInstance = await getPlatform();
  }
  return platformInstance;
}

function createWindow(): void {
  const preloadPath = isDev
    ? join(__dirname, '../renderer/preload.js') // In dev, preload is compiled to dist/main/renderer
    : join(__dirname, '../renderer/preload.js');

  const iconPath = isDev
    ? join(__dirname, '../../../src/assets/icon.png')
    : join(process.resourcesPath, 'assets/icon.png');

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    icon: iconPath,
    show: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'CineScreen',
    resizable: true,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Set up log forwarding after window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    const logSender = (message: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('debug-log', message);
      }
    };
    setLogSender(logSender);
  });
}

app.whenReady().then(() => {
  logger.info('App ready, showing recording bar in idle mode');
  showRecordingBarIdle();

  app.on('activate', () => {
    // Show recording bar if no windows are visible
    const recordingBar = getRecordingBarWindow();
    if (!recordingBar || recordingBar.isDestroyed()) {
      logger.info('App activated, showing recording bar');
      showRecordingBarIdle();
    } else if (!recordingBar.isVisible()) {
      recordingBar.show();
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

// IPC Handlers

ipcMain.handle('check-permissions', async () => {
  logger.debug('IPC: check-permissions called');
  const platform = await initPlatform();
  const permissions = platform.permissions.checkAll();
  logger.debug('Permissions result:', permissions);
  return permissions;
});

ipcMain.handle('request-permissions', async () => {
  logger.debug('IPC: request-permissions called');
  const platform = await initPlatform();
  await platform.permissions.requestMissing();
  logger.debug('Request permissions completed');
});

ipcMain.handle('get-detailed-permissions', async () => {
  logger.debug('IPC: get-detailed-permissions called');
  const platform = await initPlatform();
  const detailedStatus = platform.permissions.getDetailedStatus();
  logger.debug('Detailed permissions result:', detailedStatus);
  return detailedStatus;
});

ipcMain.handle('request-permission', async (_, type: 'screen-recording' | 'accessibility' | 'microphone') => {
  logger.debug(`IPC: request-permission called for: ${type}`);
  const platform = await initPlatform();

  let result;
  switch (type) {
    case 'screen-recording':
      result = await platform.permissions.requestScreenRecordingWithResult();
      break;
    case 'accessibility':
      result = await platform.permissions.requestAccessibilityWithResult();
      break;
    case 'microphone':
      result = await platform.permissions.requestMicrophoneWithResult();
      break;
    default:
      throw new Error(`Unknown permission type: ${type}`);
  }

  logger.debug(`Request permission result for ${type}:`, result);
  return result;
});

ipcMain.handle('open-system-preferences', async (_, panel: 'screen-recording' | 'accessibility' | 'microphone') => {
  logger.debug(`IPC: open-system-preferences called for: ${panel}`);
  const platform = await initPlatform();
  await platform.permissions.openSystemPreferences(panel);
  logger.debug('System preferences opened');
});

ipcMain.handle('start-recording', async (_, config: RecordingConfig) => {
  logger.info('IPC: start-recording called with config:', config);
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
  screenCapture = new ScreenCapture();
  mouseTracker = new MouseTracker();

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

  recordingState = {
    isRecording: true,
    startTime: Date.now(),
    tempVideoPath,
    tempMouseDataPath,
    outputPath: config.outputPath,
  };
  currentRecordingConfig = config;

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
    recordingState.mouseToVideoOffset = mouseToVideoOffset;
    logger.info(`Screen recording started successfully. Mouse-to-video offset: ${mouseToVideoOffset}ms`);

    // Hide main window and show recording bar
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
    showRecordingBar(recordingState.startTime || Date.now());

    return { success: true };
  } catch (error) {
    logger.error('Error starting recording:', error);
    recordingState.isRecording = false;
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

  if (!recordingState.isRecording) {
    logger.error('No recording in progress');
    throw new Error('No recording in progress');
  }

  // Stop the timer immediately so UI shows recording has ended
  stopRecordingBarTimer();

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
      const { getScreenDimensions } = await import('../processing/video-utils');
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

    recordingState = {
      isRecording: false,
      tempVideoPath: videoPath,
      metadataPath,
    };

    logger.info('Recording completed successfully');
    return {
      success: true,
      outputPath: finalVideoPath, // Return final video path
      metadataPath, // Return metadata path (saved alongside video)
    };
  } catch (error) {
    logger.error('Error processing recording:', error);
    recordingState.isRecording = false;
    // Ensure content protection is disabled even on error
    if (mainWindow) {
      mainWindow.setContentProtection(false);
    }
    throw error;
  }
});

ipcMain.handle('get-recording-state', () => {
  return recordingState;
});

ipcMain.handle('select-output-path', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Recording',
    defaultPath: `recording_${Date.now()}.mp4`,
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePath;
});

ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Video File',
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('select-metadata-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Metadata File',
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// Studio window IPC handlers
ipcMain.handle('open-studio', async (_, videoPath: string, metadataPath: string) => {
  logger.info('IPC: open-studio called', { videoPath, metadataPath });

  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  if (!existsSync(metadataPath)) {
    throw new Error(`Metadata file not found: ${metadataPath}`);
  }

  createStudioWindow(videoPath, metadataPath);
  return { success: true };
});

ipcMain.handle('load-metadata', async (_, metadataPath: string): Promise<RecordingMetadata> => {
  logger.info('IPC: load-metadata called', { metadataPath });

  if (!existsSync(metadataPath)) {
    throw new Error(`Metadata file not found: ${metadataPath}`);
  }

  return MetadataExporter.loadMetadata(metadataPath);
});

ipcMain.handle('get-video-info', async (_, videoPath: string) => {
  logger.info('IPC: get-video-info called', { videoPath });

  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const { getVideoDimensions } = await import('../processing/video-utils');
  const dimensions = await getVideoDimensions(videoPath);

  // Get video duration and frame rate using FFprobe or similar
  // For now, return dimensions and estimate frame rate
  return {
    width: dimensions.width,
    height: dimensions.height,
    frameRate: DEFAULT_FRAME_RATE, // Default, could be extracted from video
    duration: 0, // Would need to extract from video metadata
  };
});

ipcMain.handle('export-video-from-studio', async (_, videoPath: string, metadataPath: string, metadata: RecordingMetadata) => {
  logger.info('IPC: export-video-from-studio called', { videoPath, metadataPath });

  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  if (!existsSync(metadataPath)) {
    throw new Error(`Metadata file not found: ${metadataPath}`);
  }

  // Show save dialog for output
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export Video',
    defaultPath: `recording_${Date.now()}.mp4`,
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) {
    throw new Error('Export cancelled');
  }

  const outputPath = result.filePath;

  try {
    // Process video from metadata
    const processor = new VideoProcessor();
    await processor.processVideoFromMetadata({
      inputVideo: videoPath,
      outputVideo: outputPath,
      metadata,
      onProgress: (percent, message) => {
        logger.debug(`Export progress: ${percent}% - ${message}`);
        const studioWindow = getStudioWindow();
        if (studioWindow && !studioWindow.isDestroyed()) {
          studioWindow.webContents.send('processing-progress', { percent, message });
        }
      },
    });

    logger.info('Video exported successfully');
    return {
      success: true,
      outputPath,
    };
  } catch (error) {
    logger.error('Export failed:', error);
    throw error;
  }
});

// Save metadata to the original JSON file
ipcMain.handle('save-metadata', async (_event, filePath: string, metadata: object) => {
  try {
    const { writeFileSync } = await import('fs');
    writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
    logger.info(`Metadata saved to: ${filePath}`);
    return { success: true };
  } catch (error) {
    logger.error('Failed to save metadata:', error);
    throw error;
  }
});

// Reload metadata from the original JSON file
ipcMain.handle('reload-metadata', async (_event, filePath: string) => {
  try {
    const { readFileSync } = await import('fs');
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    logger.info(`Metadata reloaded from: ${filePath}`);
    return { success: true, data };
  } catch (error) {
    logger.error('Failed to reload metadata:', error);
    throw error;
  }
});

// Recording Bar IPC Handlers

// Helper function to cleanup recording state without saving
async function cleanupRecording(saveFiles: boolean = false): Promise<void> {
  const platform = await initPlatform();

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

// Stop recording from recording bar (same as normal stop)
ipcMain.handle('recording-bar-stop', async () => {
  logger.info('IPC: recording-bar-stop called');

  if (!recordingState.isRecording) {
    logger.warn('No recording in progress');
    return;
  }

  // Stop the timer immediately so UI shows recording has ended
  stopRecordingBarTimer();

  // Use default configs for stop
  const cursorConfig: CursorConfig = {
    size: DEFAULT_CURSOR_SIZE,
    shape: 'arrow',
  };

  const zoomConfig: ZoomConfig = {
    enabled: true,
    level: 2.0,
    transitionSpeed: 300,
    padding: 0,
    followSpeed: 1.0,
  };

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
      const { getScreenDimensions } = await import('../processing/video-utils');
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
      frameRate: DEFAULT_FRAME_RATE,
      videoDuration: recordingDuration,
      screenDimensions,
      recordingRegion: currentRecordingConfig?.region,
    });

    logger.info('Recording completed successfully');

    recordingState = {
      isRecording: false,
      tempVideoPath: videoPath,
      metadataPath,
    };

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
    await cleanupRecording(false);
    throw error;
  }
});

// Restart recording from recording bar (cancel current and start new)
ipcMain.handle('recording-bar-restart', async () => {
  logger.info('IPC: recording-bar-restart called');

  if (!recordingState.isRecording) {
    logger.warn('No recording in progress to restart');
    return;
  }

  // Store the config for restarting
  const configToRestart = currentRecordingConfig;

  // Cleanup without saving
  await cleanupRecording(false);

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

  if (!recordingState.isRecording) {
    logger.warn('No recording in progress to cancel');
    return;
  }

  await cleanupRecording(false);
  logger.info('Recording cancelled and discarded');

  // Notify main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recording-cancelled');
  }
});

// Open main window from recording bar menu
ipcMain.handle('open-main-window', async () => {
  logger.info('IPC: open-main-window called');

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
    throw new Error('Required permissions not granted. Please grant Screen Recording and Accessibility permissions.');
  }

  // Initialize components
  logger.info('Initializing screen capture and mouse tracker');
  screenCapture = new ScreenCapture();
  mouseTracker = new MouseTracker();

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
  const outputPath = join(app.getPath('downloads'), `recording_${timestamp}.mp4`);

  recordingState = {
    isRecording: true,
    startTime: Date.now(),
    tempVideoPath,
    tempMouseDataPath,
    outputPath,
  };

  // Create a default recording config
  currentRecordingConfig = {
    outputPath,
    frameRate: DEFAULT_FRAME_RATE,
  };

  try {
    // Hide the app window from screen capture
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setContentProtection(true);
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
    await screenCapture.startRecording({
      ...currentRecordingConfig,
      outputPath: tempVideoPath,
    });
    const videoStartTime = Date.now();
    const mouseToVideoOffset = videoStartTime - mouseTrackingStartTime;
    recordingState.mouseToVideoOffset = mouseToVideoOffset;
    logger.info(`Screen recording started successfully. Mouse-to-video offset: ${mouseToVideoOffset}ms`);

    // Hide the recording bar completely during recording
    hideRecordingBar();

    return { success: true };
  } catch (error) {
    logger.error('Error starting recording from bar:', error);
    recordingState.isRecording = false;
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

