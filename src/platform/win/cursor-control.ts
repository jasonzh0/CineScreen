/**
 * Windows Cursor Control
 * Wrapper for koffi-based cursor-control script
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { createLogger } from '../../utils/logger';
import type { CursorControl } from '../types';

const logger = createLogger('WinCursorControl');

let scriptPath: string | null = null;

/**
 * Find the path to the cursor-control.js script
 * Works in both development and packaged environments
 */
function findScriptPath(): string {
  if (scriptPath) {
    return scriptPath;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const projectRoot = join(__dirname, '../../../..');
    const devPath = join(projectRoot, 'src', 'platform', 'win', 'scripts', 'cursor-control.js');

    if (existsSync(devPath)) {
      scriptPath = devPath;
      logger.debug(`Found cursor-control script in dev: ${scriptPath}`);
      return scriptPath;
    }

    // Fallback to old location during transition
    const oldPath = join(projectRoot, 'src', 'windows', 'cursor-control.js');
    if (existsSync(oldPath)) {
      scriptPath = oldPath;
      logger.debug(`Found cursor-control script in old location: ${scriptPath}`);
      return scriptPath;
    }

    logger.warn(`cursor-control script not found in dev at: ${devPath}`);
  } else {
    // Packaged app - script should be in resources
    const resourcesPath = join(process.resourcesPath || '', 'platform', 'win', 'scripts', 'cursor-control.js');

    if (existsSync(resourcesPath)) {
      scriptPath = resourcesPath;
      logger.debug(`Found cursor-control script in packaged app: ${scriptPath}`);
      return scriptPath;
    }

    // Fallback to old location
    const oldResourcesPath = join(process.resourcesPath || '', 'windows', 'cursor-control.js');
    if (existsSync(oldResourcesPath)) {
      scriptPath = oldResourcesPath;
      logger.debug(`Found cursor-control script in old packaged location: ${scriptPath}`);
      return scriptPath;
    }

    logger.warn(`cursor-control script not found in packaged app at: ${resourcesPath}`);
  }

  // Fallback
  const fallbackPath = join(process.cwd(), 'src', 'platform', 'win', 'scripts', 'cursor-control.js');
  if (existsSync(fallbackPath)) {
    scriptPath = fallbackPath;
    return scriptPath;
  }

  throw new Error('Windows cursor-control script not found.');
}

/**
 * Execute cursor control command using Node.js script
 */
async function executeCursorCommand(command: 'hide' | 'show' | 'restore'): Promise<void> {
  const path = findScriptPath();

  return new Promise((resolve) => {
    const proc = spawn('node', [path, command], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let resolved = false;

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);

      if (code === 0) {
        logger.debug(`cursor-control ${command} succeeded`);
        resolve();
      } else {
        logger.warn(`cursor-control ${command} exited with code ${code}: ${stderr}`);
        resolve(); // Don't reject - cursor control is best-effort
      }
    });

    proc.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      logger.warn(`cursor-control ${command} error:`, error);
      resolve(); // Don't reject - cursor control is best-effort
    });

    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      logger.warn(`cursor-control ${command} timeout`);
      resolve(); // Don't reject - cursor control is best-effort
    }, 500);
  });
}

/**
 * Windows cursor control implementation
 */
export const cursorControl: CursorControl = {
  async hide(): Promise<void> {
    // Call hide multiple times due to reference counting
    for (let i = 0; i < 5; i++) {
      await executeCursorCommand('hide');
    }
    // Add a small delay to ensure the OS has processed the hide request
    await new Promise(resolve => setTimeout(resolve, 50));
    logger.info('System cursor hidden (Windows 5x with delay)');
  },

  async show(): Promise<void> {
    await executeCursorCommand('show');
    logger.info('System cursor shown (Windows)');
  },

  async ensureVisible(): Promise<void> {
    // Call show multiple times and then restore as a final fallback
    for (let i = 0; i < 10; i++) {
      await executeCursorCommand('show');
    }
    // Restore system cursors as a final fallback
    await executeCursorCommand('restore');
    logger.info('System cursor restored (Windows)');
  },
};
