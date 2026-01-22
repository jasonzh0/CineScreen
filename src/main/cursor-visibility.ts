import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { createLogger } from '../utils/logger';

const logger = createLogger('CursorVisibility');

let macBinaryPath: string | null = null;
let windowsScriptPath: string | null = null;

// Platform detection
const isWindows = process.platform === 'win32';

/**
 * Find the path to the cursor-control binary (macOS)
 * Works in both development and packaged environments
 */
function findMacBinaryPath(): string {
  if (macBinaryPath) {
    return macBinaryPath;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const projectRoot = join(__dirname, '../../..');
    const devPath = join(projectRoot, 'native', 'cursor-control');

    if (existsSync(devPath)) {
      macBinaryPath = devPath;
      logger.debug(`[BINARY] Found cursor-control binary in dev: ${macBinaryPath}`);
      return macBinaryPath;
    }

    logger.warn(`[BINARY] cursor-control binary not found in dev at: ${devPath}`);
  } else {
    try {
      const exePath = process.execPath;
      const appBundlePath = exePath.replace(/\/Contents\/MacOS\/.*$/, '');
      const resourcesPath = join(appBundlePath, 'Contents', 'Resources', 'cursor-control');

      if (existsSync(resourcesPath)) {
        macBinaryPath = resourcesPath;
        logger.debug(`[BINARY] Found cursor-control binary in packaged app Resources: ${macBinaryPath}`);
        return macBinaryPath;
      }

      const exeDir = dirname(exePath);
      const appBundleFromExe = exeDir.replace(/\/MacOS$/, '');
      const resourcesPath2 = join(appBundleFromExe, 'Resources', 'cursor-control');

      if (existsSync(resourcesPath2)) {
        macBinaryPath = resourcesPath2;
        logger.debug(`[BINARY] Found cursor-control binary in packaged app (method 2): ${macBinaryPath}`);
        return macBinaryPath;
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
      macBinaryPath = path;
      return macBinaryPath;
    }
  }

  throw new Error('cursor-control binary not found. Run: cd native && ./build.sh');
}

/**
 * Find the path to the cursor-control.js script (Windows)
 * Works in both development and packaged environments
 */
function findWindowsScriptPath(): string {
  if (windowsScriptPath) {
    return windowsScriptPath;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const projectRoot = join(__dirname, '../../..');
    const devPath = join(projectRoot, 'src', 'windows', 'cursor-control.js');

    if (existsSync(devPath)) {
      windowsScriptPath = devPath;
      logger.debug(`[WINDOWS] Found cursor-control script in dev: ${windowsScriptPath}`);
      return windowsScriptPath;
    }

    logger.warn(`[WINDOWS] cursor-control script not found in dev at: ${devPath}`);
  } else {
    // Packaged app - script should be in resources
    const resourcesPath = join(process.resourcesPath || '', 'windows', 'cursor-control.js');

    if (existsSync(resourcesPath)) {
      windowsScriptPath = resourcesPath;
      logger.debug(`[WINDOWS] Found cursor-control script in packaged app: ${windowsScriptPath}`);
      return windowsScriptPath;
    }

    logger.warn(`[WINDOWS] cursor-control script not found in packaged app at: ${resourcesPath}`);
  }

  // Fallback
  const fallbackPath = join(process.cwd(), 'src', 'windows', 'cursor-control.js');
  if (existsSync(fallbackPath)) {
    windowsScriptPath = fallbackPath;
    return windowsScriptPath;
  }

  throw new Error('Windows cursor-control script not found.');
}

/**
 * Execute cursor control command using native binary (macOS)
 */
async function executeCursorCommandMac(command: 'hide' | 'show'): Promise<void> {
  const binPath = findMacBinaryPath();

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
    }, 500); // 500ms timeout for cursor operations
  });
}

/**
 * Execute cursor control command using Node.js script (Windows)
 */
async function executeCursorCommandWindows(command: 'hide' | 'show' | 'restore'): Promise<void> {
  const scriptPath = findWindowsScriptPath();

  return new Promise((resolve) => {
    const proc = spawn('node', [scriptPath, command], { stdio: ['ignore', 'pipe', 'pipe'] });

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
        logger.debug(`[WINDOWS] cursor-control ${command} succeeded`);
        resolve();
      } else {
        logger.warn(`[WINDOWS] cursor-control ${command} exited with code ${code}: ${stderr}`);
        resolve(); // Don't reject - cursor control is best-effort
      }
    });

    proc.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      logger.warn(`[WINDOWS] cursor-control ${command} error:`, error);
      resolve(); // Don't reject - cursor control is best-effort
    });

    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      logger.warn(`[WINDOWS] cursor-control ${command} timeout`);
      resolve(); // Don't reject - cursor control is best-effort
    }, 500); // 500ms timeout for cursor operations
  });
}

/**
 * Hide the system cursor
 * Uses cursor-control.js script on Windows, native binary on macOS
 * Calls hide multiple times to ensure cursor is hidden (reference counting)
 */
export async function hideSystemCursor(): Promise<void> {
  if (isWindows) {
    // Windows: Call hide multiple times due to reference counting
    for (let i = 0; i < 5; i++) {
      await executeCursorCommandWindows('hide');
    }
    // Add a small delay to ensure the OS has processed the hide request
    await new Promise(resolve => setTimeout(resolve, 50));
    logger.info('System cursor hidden (Windows 5x with delay)');
  } else {
    // macOS: Call hide multiple times to ensure it's truly hidden
    // This overcomes any race conditions with the reference count
    for (let i = 0; i < 3; i++) {
      await executeCursorCommandMac('hide');
    }

    // Add a small delay to ensure the OS has processed the hide request
    // This helps prevent the cursor from briefly appearing when recording starts
    await new Promise(resolve => setTimeout(resolve, 50));

    logger.info('System cursor hidden (macOS 3x with delay)');
  }
}

/**
 * Show the system cursor
 */
export async function showSystemCursor(): Promise<void> {
  if (isWindows) {
    await executeCursorCommandWindows('show');
    logger.info('System cursor shown (Windows)');
  } else {
    await executeCursorCommandMac('show');
    logger.info('System cursor shown (macOS)');
  }
}

/**
 * Ensure cursor is visible (call this when app closes or recording ends)
 */
export async function ensureCursorVisible(): Promise<void> {
  if (isWindows) {
    // On Windows, call show multiple times and then restore as a final fallback
    for (let i = 0; i < 10; i++) {
      await executeCursorCommandWindows('show');
    }
    // Restore system cursors as a final fallback
    await executeCursorCommandWindows('restore');
    logger.info('System cursor restored (Windows)');
  } else {
    // Call show multiple times to ensure cursor is visible
    // (uses reference counting)
    for (let i = 0; i < 5; i++) {
      await showSystemCursor();
    }
  }
}
