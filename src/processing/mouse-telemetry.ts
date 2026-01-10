import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { createLogger } from '../utils/logger';
import { createInterface, Interface } from 'readline';

const logger = createLogger('MouseTelemetry');

export interface MouseTelemetryData {
  cursor: string;
  buttons: {
    left: boolean;
    right: boolean;
    middle: boolean;
  };
  position: {
    x: number;
    y: number;
  };
}

// Streaming mode state
let streamingProcess: ChildProcess | null = null;
let streamingReader: Interface | null = null;
let latestData: MouseTelemetryData | null = null;
let isStreaming = false;

// Fallback: Cache for single-shot telemetry data
let cachedData: MouseTelemetryData | null = null;
let lastCheckTime = 0;
const CACHE_DURATION = 4; // ms - keep low for high sample rate
let binaryPath: string | null = null;

// Platform detection
const isWindows = process.platform === 'win32';

/**
 * Find the path to the mouse-telemetry binary (macOS) or script (Windows)
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
      const devPath = join(projectRoot, 'src', 'windows', 'telemetry.js');
      if (existsSync(devPath)) {
        binaryPath = devPath;
        logger.debug(`[BINARY] Found Windows telemetry script in dev: ${binaryPath}`);
        return binaryPath;
      }
      logger.warn(`[BINARY] Windows telemetry script not found in dev at: ${devPath}`);
    } else {
      // Packaged app - script should be in resources
      const resourcesPath = join(process.resourcesPath || '', 'windows', 'telemetry.js');
      if (existsSync(resourcesPath)) {
        binaryPath = resourcesPath;
        logger.debug(`[BINARY] Found Windows telemetry script in packaged app: ${binaryPath}`);
        return binaryPath;
      }
      logger.warn(`[BINARY] Windows telemetry script not found in packaged app at: ${resourcesPath}`);
    }

    // Fallback
    const fallbackPath = join(process.cwd(), 'src', 'windows', 'telemetry.js');
    if (existsSync(fallbackPath)) {
      binaryPath = fallbackPath;
      return binaryPath;
    }

    throw new Error('Windows telemetry script not found.');
  }

  // macOS: original logic
  if (isDev) {
    const projectRoot = join(__dirname, '../../..');
    const devPath = join(projectRoot, 'native', 'mouse-telemetry');

    if (existsSync(devPath)) {
      binaryPath = devPath;
      logger.debug(`[BINARY] Found mouse-telemetry binary in dev: ${binaryPath}`);
      return binaryPath;
    }

    logger.warn(`[BINARY] mouse-telemetry binary not found in dev at: ${devPath}`);
  } else {
    try {
      const exePath = process.execPath;
      const appBundlePath = exePath.replace(/\/Contents\/MacOS\/.*$/, '');
      const resourcesPath = join(appBundlePath, 'Contents', 'Resources', 'mouse-telemetry');

      if (existsSync(resourcesPath)) {
        binaryPath = resourcesPath;
        logger.debug(`[BINARY] Found mouse-telemetry binary in packaged app Resources: ${binaryPath}`);
        return binaryPath;
      }

      const exeDir = dirname(exePath);
      const appBundleFromExe = exeDir.replace(/\/MacOS$/, '');
      const resourcesPath2 = join(appBundleFromExe, 'Resources', 'mouse-telemetry');

      if (existsSync(resourcesPath2)) {
        binaryPath = resourcesPath2;
        logger.debug(`[BINARY] Found mouse-telemetry binary in packaged app (method 2): ${binaryPath}`);
        return binaryPath;
      }

      logger.warn(`[BINARY] mouse-telemetry binary not found in packaged app. Tried: ${resourcesPath}, ${resourcesPath2}`);
    } catch (error) {
      logger.error(`[BINARY] Error finding mouse-telemetry binary path:`, error);
    }
  }

  const fallbackPaths = [
    '/usr/local/bin/mouse-telemetry',
    join(process.cwd(), 'native', 'mouse-telemetry'),
  ];

  for (const path of fallbackPaths) {
    if (existsSync(path)) {
      binaryPath = path;
      return binaryPath;
    }
  }

  throw new Error('mouse-telemetry binary not found. Run: cd native && ./build.sh');
}

/**
 * Start streaming telemetry from the binary
 * This runs the binary once and continuously reads data at high frequency
 */
export function startTelemetryStream(): void {
  if (isStreaming) {
    logger.debug('[STREAM] Already streaming');
    return;
  }

  try {
    const binPath = findBinaryPath();
    logger.info('[STREAM] Starting telemetry stream');

    // On Windows, spawn node with the script; on macOS, spawn the binary directly
    if (isWindows) {
      streamingProcess = spawn('node', [binPath, '--stream'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      streamingProcess = spawn(binPath, ['--stream'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    isStreaming = true;

    streamingReader = createInterface({
      input: streamingProcess.stdout!,
      crlfDelay: Infinity,
    });

    streamingReader.on('line', (line) => {
      try {
        const data: MouseTelemetryData = JSON.parse(line);
        latestData = data;
      } catch {
        // Ignore parse errors
      }
    });

    streamingProcess.on('close', (code) => {
      logger.info(`[STREAM] Process closed with code ${code}`);
      isStreaming = false;
      streamingProcess = null;
      streamingReader = null;
    });

    streamingProcess.on('error', (error) => {
      logger.error('[STREAM] Process error:', error);
      isStreaming = false;
      streamingProcess = null;
      streamingReader = null;
    });

    streamingProcess.stderr?.on('data', (data) => {
      logger.debug('[STREAM] stderr:', data.toString());
    });

  } catch (error) {
    logger.error('[STREAM] Failed to start:', error);
    isStreaming = false;
  }
}

/**
 * Stop the telemetry stream
 */
export function stopTelemetryStream(): void {
  if (!isStreaming || !streamingProcess) {
    return;
  }

  logger.info('[STREAM] Stopping telemetry stream');
  isStreaming = false;

  if (streamingReader) {
    streamingReader.close();
    streamingReader = null;
  }

  if (streamingProcess) {
    streamingProcess.kill();
    streamingProcess = null;
  }

  latestData = null;
}

/**
 * Check if streaming is active
 */
export function isStreamingActive(): boolean {
  return isStreaming;
}

/**
 * Get all mouse telemetry data
 * Uses streaming mode if active, otherwise falls back to single-shot
 */
export async function getMouseTelemetry(): Promise<MouseTelemetryData> {
  // If streaming, return latest data immediately
  if (isStreaming && latestData) {
    return latestData;
  }

  // Fallback to single-shot mode
  const now = Date.now();

  // Return cached result if still fresh
  if (cachedData && (now - lastCheckTime) < CACHE_DURATION) {
    return cachedData;
  }

  try {
    const binPath = findBinaryPath();

    const result = await new Promise<string>((resolve, reject) => {
      // On Windows, spawn node with the script; on macOS, spawn the binary directly
      const binary = isWindows
        ? spawn('node', [binPath], { stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn(binPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      binary.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      binary.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      binary.on('close', (code) => {
        if (resolved) return;

        resolved = true;
        clearTimeout(timeoutId);

        if (code === 0) {
          resolve(stdout.trim());
        } else {
          logger.error(`[ERROR] mouse-telemetry binary exited with code ${code}`);
          logger.error(`[ERROR] stderr: ${stderr}`);
          reject(new Error(`Binary exited with code ${code}: ${stderr}`));
        }
      });

      binary.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        logger.error('[ERROR] Failed to spawn mouse-telemetry binary:', error);
        reject(error);
      });

      const timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        binary.kill();
        logger.error('[ERROR] mouse-telemetry binary timeout');
        reject(new Error('Binary timeout'));
      }, 50); // 50ms timeout
    });

    const data: MouseTelemetryData = JSON.parse(result);
    cachedData = data;
    lastCheckTime = now;

    return data;
  } catch (error) {
    logger.error('[ERROR] Mouse telemetry detection failed:', error);

    if (cachedData) {
      return cachedData;
    }

    return {
      cursor: 'arrow',
      buttons: { left: false, right: false, middle: false },
      position: { x: 0, y: 0 },
    };
  }
}

// Convenience functions for backwards compatibility
export async function getMouseButtonStates(): Promise<{ left: boolean; right: boolean; middle: boolean }> {
  const data = await getMouseTelemetry();
  return data.buttons;
}

export async function getCursorType(): Promise<string> {
  const data = await getMouseTelemetry();
  return data.cursor;
}

export async function getMousePosition(): Promise<{ x: number; y: number }> {
  const data = await getMouseTelemetry();
  return data.position;
}
