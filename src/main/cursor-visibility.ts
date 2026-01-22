import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { createLogger } from '../utils/logger';

const logger = createLogger('CursorVisibility');

let binaryPath: string | null = null;

// Platform detection
const isWindows = process.platform === 'win32';

// Windows: koffi cursor control (initialized lazily)
let windowsKoffiInitialized = false;
let ShowCursor: any = null;
let SystemParametersInfoW: any = null;
const SPI_SETCURSORS = 0x0057;

/**
 * Initialize koffi for Windows cursor control
 */
function initializeWindowsCursorControl(): boolean {
  if (windowsKoffiInitialized) {
    return true;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');

    ShowCursor = user32.func('int ShowCursor(bool bShow)');
    SystemParametersInfoW = user32.func('bool SystemParametersInfoW(uint uiAction, uint uiParam, pointer pvParam, uint fWinIni)');

    windowsKoffiInitialized = true;
    logger.info('[WINDOWS] Koffi cursor control initialized successfully');
    return true;
  } catch (error) {
    logger.error('[WINDOWS] Failed to initialize koffi cursor control:', error);
    return false;
  }
}

/**
 * Hide cursor on Windows using koffi ShowCursor API
 */
function hideWindowsCursor(): void {
  if (!initializeWindowsCursorControl()) return;

  try {
    // ShowCursor uses reference counting - call multiple times to ensure hidden
    // Cursor is hidden when internal counter < 0
    for (let i = 0; i < 5; i++) {
      ShowCursor(false);
    }
    logger.debug('[WINDOWS] Cursor hidden via ShowCursor');
  } catch (error) {
    logger.error('[WINDOWS] Error hiding cursor:', error);
  }
}

/**
 * Show cursor on Windows using koffi ShowCursor API
 */
function showWindowsCursor(): void {
  if (!initializeWindowsCursorControl()) return;

  try {
    // Increment count multiple times to ensure cursor is visible
    for (let i = 0; i < 10; i++) {
      ShowCursor(true);
    }
    // Also restore system cursors as a fallback
    SystemParametersInfoW(SPI_SETCURSORS, 0, null, 0);
    logger.debug('[WINDOWS] Cursor shown via ShowCursor');
  } catch (error) {
    logger.error('[WINDOWS] Error showing cursor:', error);
  }
}

/**
 * Find the path to the cursor-control binary (macOS only)
 * Works in both development and packaged environments
 */
function findBinaryPath(): string {
  if (binaryPath) {
    return binaryPath;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
 * Execute cursor control command using native binary (macOS only)
 */
async function executeCursorCommandMac(command: 'hide' | 'show'): Promise<void> {
  const binPath = findBinaryPath();

  return new Promise((resolve, reject) => {
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
 * Hide the system cursor
 * Uses ShowCursor API on Windows, native binary on macOS
 * Calls hide multiple times to ensure cursor is hidden (reference counting)
 */
export async function hideSystemCursor(): Promise<void> {
  if (isWindows) {
    hideWindowsCursor();
    // Add a small delay to ensure the OS has processed the hide request
    await new Promise(resolve => setTimeout(resolve, 50));
    logger.info('System cursor hidden (Windows koffi)');
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
    showWindowsCursor();
    logger.info('System cursor shown (Windows koffi)');
  } else {
    await executeCursorCommandMac('show');
    logger.info('System cursor shown (macOS)');
  }
}

/**
 * Ensure cursor is visible (call this when app closes or recording ends)
 */
export async function ensureCursorVisible(): Promise<void> {
  // Call show multiple times to ensure cursor is visible
  // (uses reference counting)
  for (let i = 0; i < 5; i++) {
    await showSystemCursor();
  }
}



