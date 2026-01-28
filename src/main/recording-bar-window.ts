import { BrowserWindow, screen } from 'electron';
import { join } from 'path';

type RecordingBarMode = 'idle' | 'recording';

let recordingBarWindow: BrowserWindow | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let recordingStartTime: number = 0;
let currentMode: RecordingBarMode = 'idle';

const isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged;

const BAR_WIDTH = 208;
const BAR_HEIGHT = 48;

function createRecordingBarWindow(): BrowserWindow {
  if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
    return recordingBarWindow;
  }

  const preloadPath = isDev
    ? join(__dirname, '../renderer/recording-bar-preload.js')
    : join(__dirname, '../renderer/recording-bar-preload.js');

  recordingBarWindow = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    movable: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
    ...(process.platform === 'darwin' && {
      vibrancy: 'under-window' as const,
      visualEffectState: 'active' as const,
    }),
  });

  // Hide recording bar from screen capture
  recordingBarWindow.setContentProtection(true);

  // Position at bottom center of primary display
  positionBarAtBottomCenter();

  if (isDev) {
    recordingBarWindow.loadURL('http://localhost:3000/recording-bar.html');
  } else {
    recordingBarWindow.loadFile(join(__dirname, '../../renderer/recording-bar.html'));
  }

  recordingBarWindow.on('closed', () => {
    recordingBarWindow = null;
    stopTimerUpdates();
  });

  return recordingBarWindow;
}

function positionBarAtBottomCenter(): void {
  if (!recordingBarWindow) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const [barWidth] = recordingBarWindow.getSize();

  const x = Math.round((screenWidth - barWidth) / 2);
  const y = screenHeight - 80; // 80px from bottom

  recordingBarWindow.setPosition(x, y);
}

function updateBarSize(): void {
  if (!recordingBarWindow || recordingBarWindow.isDestroyed()) return;

  recordingBarWindow.setSize(BAR_WIDTH, BAR_HEIGHT);
  positionBarAtBottomCenter();
}

export function showRecordingBarIdle(): void {
  currentMode = 'idle';
  recordingStartTime = 0;
  stopTimerUpdates();

  if (!recordingBarWindow || recordingBarWindow.isDestroyed()) {
    createRecordingBarWindow();
  } else {
    updateBarSize();
  }

  if (recordingBarWindow) {
    recordingBarWindow.show();
    sendStateUpdate({ isRecording: false, elapsedMs: 0, mode: 'idle' });
  }
}

export function showRecordingBar(startTime: number): void {
  currentMode = 'recording';
  recordingStartTime = startTime;

  if (!recordingBarWindow || recordingBarWindow.isDestroyed()) {
    createRecordingBarWindow();
  } else {
    updateBarSize();
  }

  if (recordingBarWindow) {
    recordingBarWindow.show();
    startTimerUpdates();
    sendStateUpdate({ isRecording: true, elapsedMs: 0, mode: 'recording' });
  }
}

export function hideRecordingBar(): void {
  stopTimerUpdates();

  if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
    recordingBarWindow.hide();
  }
}

function destroyRecordingBar(): void {
  stopTimerUpdates();

  if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
    recordingBarWindow.close();
    recordingBarWindow = null;
  }
}

export function getRecordingBarWindow(): BrowserWindow | null {
  return recordingBarWindow;
}

function startTimerUpdates(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(() => {
    if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
      const elapsedMs = Date.now() - recordingStartTime;
      sendStateUpdate({ isRecording: true, elapsedMs, mode: 'recording' });
    }
  }, 100); // Update every 100ms for smooth timer display
}

function stopTimerUpdates(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

export function stopRecordingBarTimer(): void {
  stopTimerUpdates();
  // Send final state to indicate recording has stopped
  sendStateUpdate({ isRecording: false, elapsedMs: Date.now() - recordingStartTime, mode: 'idle' });
}

function sendStateUpdate(state: { isRecording: boolean; elapsedMs: number; mode: RecordingBarMode }): void {
  if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
    recordingBarWindow.webContents.send('recording-state-update', state);
  }
}
