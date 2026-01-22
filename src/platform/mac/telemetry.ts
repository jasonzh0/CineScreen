/**
 * macOS Mouse Telemetry
 * Wrapper for native mouse-telemetry binary
 */

import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { createLogger } from '../../utils/logger';
import { createInterface, Interface } from 'readline';
import type { Telemetry, MouseTelemetryData } from '../types';

const logger = createLogger('MacTelemetry');

// Streaming mode state
let streamingProcess: ChildProcess | null = null;
let streamingReader: Interface | null = null;
let latestData: MouseTelemetryData | null = null;
let isStreaming = false;

// Cache for single-shot telemetry data
let cachedData: MouseTelemetryData | null = null;
let lastCheckTime = 0;
const CACHE_DURATION = 4; // ms - keep low for high sample rate
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
    const projectRoot = join(__dirname, '../../../..');
    const devPath = join(projectRoot, 'native', 'mouse-telemetry');

    if (existsSync(devPath)) {
      binaryPath = devPath;
      logger.debug(`Found mouse-telemetry binary in dev: ${binaryPath}`);
      return binaryPath;
    }

    logger.warn(`mouse-telemetry binary not found in dev at: ${devPath}`);
  } else {
    try {
      const exePath = process.execPath;
      const appBundlePath = exePath.replace(/\/Contents\/MacOS\/.*$/, '');
      const resourcesPath = join(appBundlePath, 'Contents', 'Resources', 'mouse-telemetry');

      if (existsSync(resourcesPath)) {
        binaryPath = resourcesPath;
        logger.debug(`Found mouse-telemetry binary in packaged app Resources: ${binaryPath}`);
        return binaryPath;
      }

      const exeDir = dirname(exePath);
      const appBundleFromExe = exeDir.replace(/\/MacOS$/, '');
      const resourcesPath2 = join(appBundleFromExe, 'Resources', 'mouse-telemetry');

      if (existsSync(resourcesPath2)) {
        binaryPath = resourcesPath2;
        logger.debug(`Found mouse-telemetry binary in packaged app (method 2): ${binaryPath}`);
        return binaryPath;
      }

      logger.warn(`mouse-telemetry binary not found in packaged app. Tried: ${resourcesPath}, ${resourcesPath2}`);
    } catch (error) {
      logger.error(`Error finding mouse-telemetry binary path:`, error);
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
 * Get telemetry data with single-shot query (fallback)
 */
async function getSingleShotTelemetry(): Promise<MouseTelemetryData> {
  const now = Date.now();

  // Return cached result if still fresh
  if (cachedData && (now - lastCheckTime) < CACHE_DURATION) {
    return cachedData;
  }

  try {
    const binPath = findBinaryPath();

    const result = await new Promise<string>((resolve, reject) => {
      const binary = spawn(binPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });

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
          logger.error(`mouse-telemetry binary exited with code ${code}`);
          logger.error(`stderr: ${stderr}`);
          reject(new Error(`Binary exited with code ${code}: ${stderr}`));
        }
      });

      binary.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        logger.error('Failed to spawn mouse-telemetry binary:', error);
        reject(error);
      });

      const timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        binary.kill();
        logger.error('mouse-telemetry binary timeout');
        reject(new Error('Binary timeout'));
      }, 50);
    });

    const data: MouseTelemetryData = JSON.parse(result);
    cachedData = data;
    lastCheckTime = now;

    return data;
  } catch (error) {
    logger.error('Mouse telemetry detection failed:', error);

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

/**
 * macOS telemetry implementation
 */
export const telemetry: Telemetry = {
  start(): void {
    if (isStreaming) {
      logger.debug('Already streaming');
      return;
    }

    try {
      logger.info('Starting telemetry stream');

      const binPath = findBinaryPath();
      streamingProcess = spawn(binPath, ['--stream'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

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
        logger.info(`Streaming process closed with code ${code}`);
        isStreaming = false;
        streamingProcess = null;
        streamingReader = null;
      });

      streamingProcess.on('error', (error) => {
        logger.error('Streaming process error:', error);
        isStreaming = false;
        streamingProcess = null;
        streamingReader = null;
      });

      streamingProcess.stderr?.on('data', (data) => {
        logger.debug('Streaming stderr:', data.toString());
      });
    } catch (error) {
      logger.error('Failed to start streaming:', error);
      isStreaming = false;
    }
  },

  stop(): void {
    if (!isStreaming) {
      return;
    }

    logger.info('Stopping telemetry stream');
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
  },

  async getData(): Promise<MouseTelemetryData> {
    // If streaming, return latest data immediately
    if (isStreaming && latestData) {
      return latestData;
    }

    // Fallback to single-shot mode
    return getSingleShotTelemetry();
  },

  isActive(): boolean {
    return isStreaming;
  },
};
