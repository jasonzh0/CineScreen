import { BrowserWindow, screen } from 'electron';
import { join } from 'path';

let recordingBarWindow: BrowserWindow | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let recordingStartTime: number = 0;

const isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged;

function createRecordingBarWindow(): BrowserWindow {
  if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
    return recordingBarWindow;
  }

  const preloadPath = isDev
    ? join(__dirname, '../renderer/recording-bar-preload.js')
    : join(__dirname, '../renderer/recording-bar-preload.js');

  recordingBarWindow = new BrowserWindow({
    width: 280,
    height: 56,
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

export function showRecordingBar(startTime: number): void {
  recordingStartTime = startTime;

  if (!recordingBarWindow || recordingBarWindow.isDestroyed()) {
    createRecordingBarWindow();
  }

  if (recordingBarWindow) {
    recordingBarWindow.show();
    startTimerUpdates();
    sendStateUpdate({ isRecording: true, elapsedMs: 0 });
  }
}

export function hideRecordingBar(): void {
  stopTimerUpdates();

  if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
    recordingBarWindow.hide();
  }
}

export function destroyRecordingBar(): void {
  stopTimerUpdates();

  if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
    recordingBarWindow.close();
    recordingBarWindow = null;
  }
}

function getRecordingBarWindow(): BrowserWindow | null {
  return recordingBarWindow;
}

function startTimerUpdates(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(() => {
    if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
      const elapsedMs = Date.now() - recordingStartTime;
      sendStateUpdate({ isRecording: true, elapsedMs });
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
  sendStateUpdate({ isRecording: false, elapsedMs: Date.now() - recordingStartTime });
}

function sendStateUpdate(state: { isRecording: boolean; elapsedMs: number }): void {
  if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
    recordingBarWindow.webContents.send('recording-state-update', state);
  }
}

function sendTimerUpdate(elapsedMs: number): void {
  if (recordingBarWindow && !recordingBarWindow.isDestroyed()) {
    recordingBarWindow.webContents.send('recording-timer-update', elapsedMs);
  }
}
