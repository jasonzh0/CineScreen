/**
 * Dialog-related IPC handlers
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { setConfiguredOutputPath, getConfiguredOutputPath } from '../state';

/**
 * Register dialog-related IPC handlers
 * @param getMainWindow - Function to get main window
 */
export function registerDialogHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('select-output-path', async () => {
    const mainWindow = getMainWindow();
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

    // Store the configured output path
    setConfiguredOutputPath(result.filePath || null);
    return result.filePath;
  });

  ipcMain.handle('set-output-path', async (_, path: string | null) => {
    setConfiguredOutputPath(path);
    return { success: true };
  });

  ipcMain.handle('get-output-path', async () => {
    return getConfiguredOutputPath();
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
}
