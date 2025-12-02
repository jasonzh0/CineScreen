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
import type { RecordingConfig, CursorConfig, RecordingState } from '../types';

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
    width: 400,
    height: 600,
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
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
  return await checkAllPermissions();
});

ipcMain.handle('request-permissions', async () => {
  await requestMissingPermissions();
});

ipcMain.handle('start-recording', async (_, config: RecordingConfig) => {
  if (recordingState.isRecording) {
    throw new Error('Recording is already in progress');
  }

  // Check permissions first
  const permissions = await checkAllPermissions();
  if (!permissions.screenRecording || !permissions.accessibility) {
    throw new Error('Required permissions not granted');
  }

  // Initialize components
  screenCapture = new ScreenCapture();
  mouseTracker = new MouseTracker();

  // Generate temp file paths
  const tempDir = join(app.getPath('temp'), 'screen-recorder');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const timestamp = Date.now();
  const tempVideoPath = join(tempDir, `recording_${timestamp}.mp4`);
  const tempMouseDataPath = join(tempDir, `mouse_${timestamp}.json`);

  recordingState = {
    isRecording: true,
    startTime: Date.now(),
    tempVideoPath,
    tempMouseDataPath,
    outputPath: config.outputPath,
  };

  try {
    // Start mouse tracking
    await mouseTracker.startTracking();

    // Start screen recording
    await screenCapture.startRecording({
      ...config,
      outputPath: tempVideoPath,
    });

    return { success: true };
  } catch (error) {
    recordingState.isRecording = false;
    mouseTracker?.stopTracking();
    throw error;
  }
});

ipcMain.handle('stop-recording', async (_, cursorConfig: CursorConfig) => {
  if (!recordingState.isRecording) {
    throw new Error('No recording in progress');
  }

  try {
    // Stop screen recording
    const videoPath = await screenCapture?.stopRecording();
    if (!videoPath) {
      throw new Error('Failed to stop recording');
    }

    // Stop mouse tracking
    mouseTracker?.stopTracking();

    // Save mouse data
    if (mouseTracker && recordingState.tempMouseDataPath) {
      mouseTracker.saveToFile(recordingState.tempMouseDataPath);
    }

    // Get mouse events
    const mouseEvents = mouseTracker?.getEvents() || [];
    const recordingDuration = Date.now() - (recordingState.startTime || 0);

    // Process video with cursor overlay
    const processor = new VideoProcessor();
    const finalOutputPath =
      recordingState.outputPath ||
      join(app.getPath('downloads'), `recording_${Date.now()}.mp4`);

    await processor.processVideo({
      inputVideo: videoPath,
      outputVideo: finalOutputPath,
      mouseEvents,
      cursorConfig,
      frameRate: 30,
      videoDuration: recordingDuration,
    });

    // Clean up temp files
    // (In production, you'd want to clean these up)

    recordingState = {
      isRecording: false,
    };

    return {
      success: true,
      outputPath: finalOutputPath,
    };
  } catch (error) {
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

