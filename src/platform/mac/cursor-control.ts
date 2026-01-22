/**
 * macOS Cursor Control
 * Wrapper for native cursor-control binary
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { createLogger } from '../../utils/logger';
import type { CursorControl } from '../types';

const logger = createLogger('MacCursorControl');

let binaryPath: string | null = null;

/**
 * Find the path to the cursor-control binary
 * Works in both development and packaged environments
 */
function findBinaryPath(): string {
  if (binaryPath) {
    return binaryPath;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const projectRoot = join(__dirname, '../../../..');
    const devPath = join(projectRoot, 'native', 'cursor-control');

    if (existsSync(devPath)) {
      binaryPath = devPath;
      logger.debug(`Found cursor-control binary in dev: ${binaryPath}`);
      return binaryPath;
    }

    logger.warn(`cursor-control binary not found in dev at: ${devPath}`);
  } else {
    try {
      const exePath = process.execPath;
      const appBundlePath = exePath.replace(/\/Contents\/MacOS\/.*$/, '');
      const resourcesPath = join(appBundlePath, 'Contents', 'Resources', 'cursor-control');

      if (existsSync(resourcesPath)) {
        binaryPath = resourcesPath;
        logger.debug(`Found cursor-control binary in packaged app Resources: ${binaryPath}`);
        return binaryPath;
      }

      const exeDir = dirname(exePath);
      const appBundleFromExe = exeDir.replace(/\/MacOS$/, '');
      const resourcesPath2 = join(appBundleFromExe, 'Resources', 'cursor-control');

      if (existsSync(resourcesPath2)) {
        binaryPath = resourcesPath2;
        logger.debug(`Found cursor-control binary in packaged app (method 2): ${binaryPath}`);
        return binaryPath;
      }

      logger.warn(`cursor-control binary not found in packaged app. Tried: ${resourcesPath}, ${resourcesPath2}`);
    } catch (error) {
      logger.error(`Error finding cursor-control binary path:`, error);
    }
  }

  const fallbackPaths = [
    '/usr/local/bin/cursor-control',
    join(process.cwd(), 'native', 'cursor-control'),
  ];

  for (const path of fallbackPaths) {
    if (existsSync(path)) {
      binaryPath = path;
      return binaryPath;
    }
  }

  throw new Error('cursor-control binary not found. Run: cd native && ./build.sh');
}

/**
 * Execute cursor control command using native binary
 */
async function executeCursorCommand(command: 'hide' | 'show'): Promise<void> {
  const binPath = findBinaryPath();

  return new Promise((resolve) => {
    const binary = spawn(binPath, [command], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let resolved = false;

    binary.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    binary.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);

      if (code === 0) {
        resolve();
      } else {
        logger.warn(`cursor-control ${command} exited with code ${code}: ${stderr}`);
        resolve(); // Don't reject - cursor control is best-effort
      }
    });

    binary.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      logger.warn(`cursor-control ${command} error:`, error);
      resolve(); // Don't reject - cursor control is best-effort
    });

    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      binary.kill();
      logger.warn(`cursor-control ${command} timeout`);
      resolve(); // Don't reject - cursor control is best-effort
    }, 500);
  });
}

/**
 * macOS cursor control implementation
 */
export const cursorControl: CursorControl = {
  async hide(): Promise<void> {
    // Call hide multiple times to ensure it's truly hidden
    // This overcomes any race conditions with the reference count
    for (let i = 0; i < 3; i++) {
      await executeCursorCommand('hide');
    }

    // Add a small delay to ensure the OS has processed the hide request
    await new Promise(resolve => setTimeout(resolve, 50));

    logger.info('System cursor hidden (macOS 3x with delay)');
  },

  async show(): Promise<void> {
    await executeCursorCommand('show');
    logger.info('System cursor shown (macOS)');
  },

  async ensureVisible(): Promise<void> {
    // Call show multiple times to ensure cursor is visible
    // (uses reference counting)
    for (let i = 0; i < 5; i++) {
      await executeCursorCommand('show');
    }
    logger.info('System cursor ensured visible (macOS)');
  },
};
