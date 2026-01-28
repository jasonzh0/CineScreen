/**
 * IPC handlers barrel export and registration
 */

import type { BrowserWindow } from 'electron';
import type { Platform } from '../../platform';
import { registerPermissionHandlers } from './permissions';
import { registerRecordingHandlers } from './recording';
import { registerRecordingBarHandlers } from './recording-bar';
import { registerDialogHandlers } from './dialogs';
import { registerStudioHandlers } from './studio';

/**
 * Register all IPC handlers
 * @param initPlatform - Function to initialize/get platform instance
 * @param getMainWindow - Function to get main window
 * @param createWindow - Function to create main window
 */
export function registerAllIpcHandlers(
  initPlatform: () => Promise<Platform>,
  getMainWindow: () => BrowserWindow | null,
  createWindow: () => void
): void {
  registerPermissionHandlers(initPlatform);
  registerRecordingHandlers(initPlatform, getMainWindow);
  registerRecordingBarHandlers(initPlatform, getMainWindow, createWindow);
  registerDialogHandlers(getMainWindow);
  registerStudioHandlers(getMainWindow);
}
