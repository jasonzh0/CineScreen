import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ScreenCapture } from './screen-capture';
import { MouseTracker } from './mouse-tracker';
import { VideoProcessor } from '../processing/video-processor';
import {
  checkAllPermissions,
  requestMissingPermissions,
} from './permissions';
import type { RecordingConfig, CursorConfig, RecordingState, ZoomConfig, MouseEffectsConfig } from '../types';
import { createLogger, setLogSender } from '../utils/logger';

// Create logger for main process
const logger = createLogger('Main');

let mainWindow: BrowserWindow | null = null;
let screenCapture: ScreenCapture | null = null;
let mouseTracker: MouseTracker | null = null;
let recordingState: RecordingState = {
  isRecording: false,
};

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow(): void {
  const preloadPath = isDev
    ? join(__dirname, '../renderer/preload.js') // In dev, preload is compiled to dist/main/renderer
    : join(__dirname, '../renderer/preload.js');

  mainWindow = new BrowserWindow({
    width: 500,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Mac Screen Recorder',
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

  try {
    // Start mouse tracking
    logger.info('Starting mouse tracking...');
    await mouseTracker.startTracking();
    logger.info('Mouse tracking started');

    // Start screen recording
    logger.info('Starting screen recording...');
    await screenCapture.startRecording({
      ...config,
      outputPath: tempVideoPath,
    });
    logger.info('Screen recording started successfully');

    return { success: true };
  } catch (error) {
    logger.error('Error starting recording:', error);
    recordingState.isRecording = false;
    mouseTracker?.stopTracking();
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
      size: 24,
      shape: 'arrow',
      smoothing: 0.5,
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

    // Process video with cursor overlay
    logger.info('Processing video with cursor overlay...');
    const processor = new VideoProcessor();
    const finalOutputPath =
      recordingState.outputPath ||
      join(app.getPath('downloads'), `recording_${Date.now()}.mp4`);
    logger.debug('Final output path:', finalOutputPath);

    await processor.processVideo({
      inputVideo: videoPath,
      outputVideo: finalOutputPath,
      mouseEvents,
      cursorConfig,
      zoomConfig,
      mouseEffectsConfig,
      frameRate: 30,
      videoDuration: recordingDuration,
    });

    // Clean up temp files
    // (In production, you'd want to clean these up)

    recordingState = {
      isRecording: false,
    };

    logger.info('Recording processing completed successfully');
    return {
      success: true,
      outputPath: finalOutputPath,
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

