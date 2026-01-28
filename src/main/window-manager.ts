/**
 * Window management for main process
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { setLogSender } from '../utils/logger';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

/**
 * Get the main window instance
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Create the main application window
 */
export function createWindow(): void {
  const preloadPath = isDev
    ? join(__dirname, '../renderer/preload.js') // In dev, preload is compiled to dist/main/renderer
    : join(__dirname, '../renderer/preload.js');

  const iconPath = isDev
    ? join(__dirname, '../../../src/assets/icon.png')
    : join(process.resourcesPath, 'assets/icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
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
