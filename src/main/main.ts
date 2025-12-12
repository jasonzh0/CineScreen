import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { ScreenCapture } from './screen-capture';
import { MouseTracker } from './mouse-tracker';
import { VideoProcessor } from '../processing/video-processor';
import { MetadataExporter } from '../processing/metadata-exporter';
import { createStudioWindow, getStudioWindow } from './studio-window';
import {
  checkAllPermissions,
  requestMissingPermissions,
} from './permissions';
import { hideSystemCursor, showSystemCursor, ensureCursorVisible } from './cursor-visibility';
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

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow(): void {
  const preloadPath = isDev
    ? join(__dirname, '../renderer/preload.js') // In dev, preload is compiled to dist/main/renderer
    : join(__dirname, '../renderer/preload.js');

  const iconPath = isDev
    ? join(__dirname, '../../../src/assets/logo.png')
    : join(process.resourcesPath, 'assets/logo.png');

  mainWindow = new BrowserWindow({
    width: 500,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'CineScreen',
    resizable: true,
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
  logger.info('App ready, creating window');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('App activated, creating new window');
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Ensure cursor is visible when app quits (in case recording was interrupted)
app.on('before-quit', async () => {
  logger.info('App quitting, ensuring cursor is visible...');
  await ensureCursorVisible();
});

// IPC Handlers

ipcMain.handle('check-permissions', async () => {
  logger.debug('IPC: check-permissions called');
  const permissions = await checkAllPermissions();
  logger.debug('Permissions result:', permissions);
  return permissions;
});

ipcMain.handle('request-permissions', async () => {
  logger.debug('IPC: request-permissions called');
  await requestMissingPermissions();
  logger.debug('Request permissions completed');
});

ipcMain.handle('start-recording', async (_, config: RecordingConfig) => {
  logger.info('IPC: start-recording called with config:', config);
  if (recordingState.isRecording) {
    logger.error('Recording already in progress');
    throw new Error('Recording is already in progress');
  }

  // Check permissions first
  logger.debug('Checking permissions...');
  const permissions = await checkAllPermissions();
  logger.debug('Permissions check result:', permissions);
  if (!permissions.screenRecording || !permissions.accessibility) {
    logger.error('Required permissions not granted');
    throw new Error('Required permissions not granted');
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
    // Start mouse tracking first
    logger.info('Starting mouse tracking...');
    const mouseTrackingStartTime = Date.now();
    await mouseTracker.startTracking();
    logger.info('Mouse tracking started');

    // Hide system cursor during recording (we'll overlay our own smooth cursor)
    logger.info('Hiding system cursor...');
    await hideSystemCursor();

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

    return { success: true };
  } catch (error) {
    logger.error('Error starting recording:', error);
    recordingState.isRecording = false;
    mouseTracker?.stopTracking();
    // Make sure cursor is visible if recording fails
    await showSystemCursor();
    throw error;
  }
});

ipcMain.handle('stop-recording', async (_, config: {
  cursorConfig?: CursorConfig;
  zoomConfig?: ZoomConfig;
  mouseEffectsConfig?: MouseEffectsConfig;
} | CursorConfig) => {
  // Handle both old format (just CursorConfig) and new format (object with cursorConfig)
  let cursorConfig: CursorConfig | undefined;
  let zoomConfig: ZoomConfig | undefined;
  let mouseEffectsConfig: MouseEffectsConfig | undefined;
  
  if (config && 'cursorConfig' in config) {
    // New format
    cursorConfig = config.cursorConfig;
    zoomConfig = config.zoomConfig;
    mouseEffectsConfig = config.mouseEffectsConfig;
  } else if (config && 'size' in config) {
    // Old format - just CursorConfig
    cursorConfig = config as CursorConfig;
  }
  
  // Provide default cursor config if not provided
  if (!cursorConfig) {
    cursorConfig = {
      size: DEFAULT_CURSOR_SIZE,
      shape: 'arrow',
      color: '#000000',
    };
  }
  
  logger.info('IPC: stop-recording called with config:', { cursorConfig, zoomConfig, mouseEffectsConfig });
  
  if (!recordingState.isRecording) {
    logger.error('No recording in progress');
    throw new Error('No recording in progress');
  }

  try {
    // Stop screen recording
    logger.info('Stopping screen recording...');
    const videoPath = await screenCapture?.stopRecording();
    logger.info('Screen recording stopped, video path:', videoPath);

    // Show system cursor again
    logger.info('Showing system cursor...');
    await ensureCursorVisible();

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

