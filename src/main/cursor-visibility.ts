import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { createLogger } from '../utils/logger';

const logger = createLogger('CursorVisibility');

let binaryPath: string | null = null;

// Platform detection
const isWindows = process.platform === 'win32';

/**
 * Find the path to the cursor-control binary (macOS) or script (Windows)
 * Works in both development and packaged environments
 */
function findBinaryPath(): string {
  if (binaryPath) {
    return binaryPath;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isWindows) {
    // On Windows, we use a Node.js script
    if (isDev) {
      const projectRoot = join(__dirname, '../../..');
      const devPath = join(projectRoot, 'src', 'windows', 'cursor-control.js');
      if (existsSync(devPath)) {
        binaryPath = devPath;
        logger.debug(`[BINARY] Found Windows cursor-control script in dev: ${binaryPath}`);
        return binaryPath;
      }
      logger.warn(`[BINARY] Windows cursor-control script not found in dev at: ${devPath}`);
    } else {
      // Packaged app - script should be in resources
      const resourcesPath = join(process.resourcesPath || '', 'windows', 'cursor-control.js');
      if (existsSync(resourcesPath)) {
        binaryPath = resourcesPath;
        logger.debug(`[BINARY] Found Windows cursor-control script in packaged app: ${binaryPath}`);
        return binaryPath;
      }
      logger.warn(`[BINARY] Windows cursor-control script not found in packaged app at: ${resourcesPath}`);
    }

    // Fallback
    const fallbackPath = join(process.cwd(), 'src', 'windows', 'cursor-control.js');
    if (existsSync(fallbackPath)) {
      binaryPath = fallbackPath;
      return binaryPath;
    }

    throw new Error('Windows cursor-control script not found.');
  }

  // macOS: original logic
  if (isDev) {
    const projectRoot = join(__dirname, '../../..');
    const devPath = join(projectRoot, 'native', 'cursor-control');

    if (existsSync(devPath)) {
      binaryPath = devPath;
      logger.debug(`[BINARY] Found cursor-control binary in dev: ${binaryPath}`);
      return binaryPath;
    }

    logger.warn(`[BINARY] cursor-control binary not found in dev at: ${devPath}`);
  } else {
    try {
      const exePath = process.execPath;
      const appBundlePath = exePath.replace(/\/Contents\/MacOS\/.*$/, '');
      const resourcesPath = join(appBundlePath, 'Contents', 'Resources', 'cursor-control');

      if (existsSync(resourcesPath)) {
        binaryPath = resourcesPath;
        logger.debug(`[BINARY] Found cursor-control binary in packaged app Resources: ${binaryPath}`);
        return binaryPath;
      }

      const exeDir = dirname(exePath);
      const appBundleFromExe = exeDir.replace(/\/MacOS$/, '');
      const resourcesPath2 = join(appBundleFromExe, 'Resources', 'cursor-control');

      if (existsSync(resourcesPath2)) {
        binaryPath = resourcesPath2;
        logger.debug(`[BINARY] Found cursor-control binary in packaged app (method 2): ${binaryPath}`);
        return binaryPath;
      }

      logger.warn(`[BINARY] cursor-control binary not found in packaged app. Tried: ${resourcesPath}, ${resourcesPath2}`);
    } catch (error) {
      logger.error(`[BINARY] Error finding cursor-control binary path:`, error);
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

  return new Promise((resolve, reject) => {
    // On Windows, spawn node with the script; on macOS, spawn the binary directly
    const binary = isWindows
      ? spawn('node', [binPath, command], { stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(binPath, [command], { stdio: ['ignore', 'pipe', 'pipe'] });

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
    }, 500); // 500ms timeout for cursor operations
  });
}

/**
 * Hide the system cursor on macOS
 * Calls hide multiple times to ensure cursor is hidden (CGDisplayHideCursor uses reference counting)
 * Also adds a small delay to ensure the OS has processed the hide request
 */
export async function hideSystemCursor(): Promise<void> {
  // Call hide multiple times to ensure it's truly hidden
  // This overcomes any race conditions with the reference count
  for (let i = 0; i < 3; i++) {
    await executeCursorCommand('hide');
  }

  // Add a small delay to ensure the OS has processed the hide request
  // This helps prevent the cursor from briefly appearing when recording starts
  await new Promise(resolve => setTimeout(resolve, 50));

  logger.info('System cursor hidden (3x with delay)');
}

/**
 * Show the system cursor on macOS
 */
export async function showSystemCursor(): Promise<void> {
  await executeCursorCommand('show');
  logger.info('System cursor shown');
}

/**
 * Ensure cursor is visible (call this when app closes or recording ends)
 */
export async function ensureCursorVisible(): Promise<void> {
  // Call show multiple times to ensure cursor is visible
  // (CGDisplayHideCursor uses a reference count)
  for (let i = 0; i < 5; i++) {
    await showSystemCursor();
  }
}



