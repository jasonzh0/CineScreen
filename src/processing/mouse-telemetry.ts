import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { createLogger } from '../utils/logger';

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

// Cache for telemetry data to avoid excessive binary calls
let cachedData: MouseTelemetryData | null = null;
let lastCheckTime = 0;
const CACHE_DURATION = 8; // ms
let binaryPath: string | null = null;

/**
 * Find the path to the mouse-telemetry binary
 * Works in both development and packaged environments
 */
function findBinaryPath(): string {
  if (binaryPath) {
    return binaryPath;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
 * Get all mouse telemetry data in a single call
 * Returns cursor type, button states, and position
 */
export async function getMouseTelemetry(): Promise<MouseTelemetryData> {
  const now = Date.now();

  // Return cached result if still fresh
  if (cachedData && (now - lastCheckTime) < CACHE_DURATION) {
    return cachedData;
  }

  try {
    const binPath = findBinaryPath();

    const result = await new Promise<string>((resolve, reject) => {
      const binary = spawn(binPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

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
