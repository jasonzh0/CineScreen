/**
 * Dialog-related IPC handlers
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { setConfiguredOutputDir, getConfiguredOutputDir } from '../state';
import { loadConfig, saveConfig } from '../state';
import type { UserConfig } from '../state';

/**
 * Register dialog-related IPC handlers
 * @param getMainWindow - Function to get main window
 */
export function registerDialogHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('select-output-path', async () => {
    const mainWindow = getMainWindow();
    const currentDir = getConfiguredOutputDir();
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select Save Location',
      defaultPath: currentDir || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    const dir = result.filePaths[0];
    setConfiguredOutputDir(dir);
    return dir;
  });

  ipcMain.handle('set-output-path', async (_, dir: string | null) => {
    setConfiguredOutputDir(dir);
    return { success: true };
  });

  ipcMain.handle('get-output-path', async () => {
    return getConfiguredOutputDir();
  });

  ipcMain.handle('select-video-file', async () => {
    const mainWindow = getMainWindow();
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
    const mainWindow = getMainWindow();
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

  ipcMain.handle('get-user-config', async () => {
    return loadConfig();
  });

  ipcMain.handle('set-user-config', async (_, partial: Partial<UserConfig>) => {
    const config = loadConfig();
    Object.assign(config, partial);
    saveConfig(config);
    return { success: true };
  });
}
