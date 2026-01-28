/**
 * Permission-related IPC handlers
 */

import { ipcMain } from 'electron';
import type { Platform } from '../../platform';
import { createLogger } from '../../utils/logger';

const logger = createLogger('IPC:Permissions');

/**
 * Register permission-related IPC handlers
 * @param initPlatform - Function to initialize/get platform instance
 */
export function registerPermissionHandlers(
  initPlatform: () => Promise<Platform>
): void {
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
}
