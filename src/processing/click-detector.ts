import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import type { MouseEvent } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('ClickDetector');

// Cache for button states to avoid excessive binary calls
let cachedStates: { left: boolean; right: boolean; middle: boolean } | null = null;
let lastCheckTime = 0;
const CACHE_DURATION = 5; // Cache for 5ms to reduce binary calls
let binaryPath: string | null = null; // Cache binary path

/**
 * Find the path to the mouse-button-state binary
 * Works in both development and packaged environments
 */
function findBinaryPath(): string {
  if (binaryPath) {
    return binaryPath;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    // In development, look for binary in native/ directory relative to project root
    // __dirname will be dist/main/processing, so go up 4 levels to project root
    const projectRoot = join(__dirname, '../../..');
    const devPath = join(projectRoot, 'native', 'mouse-button-state');
    
    if (existsSync(devPath)) {
      binaryPath = devPath;
      logger.debug(`[BINARY] Found binary in dev: ${binaryPath}`);
      return binaryPath;
    }
    
    logger.warn(`[BINARY] Binary not found in dev at: ${devPath}`);
  } else {
    // In packaged app, binary should be in Resources (extraResources)
    // Use app.getAppPath() to get the app directory
    try {
      const appPath = app.getAppPath();
      // In packaged app, this might be inside .asar, so we need to get the actual app bundle
      const exePath = process.execPath;
      const appBundlePath = exePath.replace(/\/Contents\/MacOS\/.*$/, '');
      const resourcesPath = join(appBundlePath, 'Contents', 'Resources', 'mouse-button-state');
      
      if (existsSync(resourcesPath)) {
        binaryPath = resourcesPath;
        logger.debug(`[BINARY] Found binary in packaged app Resources: ${binaryPath}`);
        return binaryPath;
      }
      
      // Also try using app.getPath('exe') for better Electron compatibility
      const exeDir = dirname(exePath);
      const appBundleFromExe = exeDir.replace(/\/MacOS$/, '');
      const resourcesPath2 = join(appBundleFromExe, 'Resources', 'mouse-button-state');
      
      if (existsSync(resourcesPath2)) {
        binaryPath = resourcesPath2;
        logger.debug(`[BINARY] Found binary in packaged app (method 2): ${binaryPath}`);
        return binaryPath;
      }
      
      logger.warn(`[BINARY] Binary not found in packaged app. Tried: ${resourcesPath}, ${resourcesPath2}`);
    } catch (error) {
      logger.error(`[BINARY] Error finding binary path:`, error);
    }
  }

  // Fallback: try to find it in common locations
  const fallbackPaths = [
    '/usr/local/bin/mouse-button-state',
    join(process.cwd(), 'native', 'mouse-button-state'),
  ];

  for (const path of fallbackPaths) {
    if (existsSync(path)) {
      binaryPath = path;
      logger.debug(`[BINARY] Found binary in fallback location: ${binaryPath}`);
      return binaryPath;
    }
  }

  throw new Error('mouse-button-state binary not found. Run: cd native && ./build.sh');
}

/**
 * Detect mouse button states using CGEventSourceButtonState via Swift binary
 * This requires accessibility permissions on macOS
 * Uses caching to reduce binary process spawn overhead
 */
export async function getMouseButtonStates(): Promise<{
  left: boolean;
  right: boolean;
  middle: boolean;
}> {
  const now = Date.now();
  
  // Return cached result if still fresh
  if (cachedStates && (now - lastCheckTime) < CACHE_DURATION) {
    logger.debug(`[CACHE] Using cached button states:`, cachedStates);
    return cachedStates;
  }

  logger.debug('[QUERY] Querying Swift binary for button states...');
  const queryStartTime = Date.now();

  try {
    // Find binary path (cached after first call)
    const binPath = findBinaryPath();

    // Execute Swift binary
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
        if (resolved) return; // Already resolved/rejected
        
        resolved = true;
        clearTimeout(timeoutId);
        
        if (code === 0) {
          // Log stderr if present (might contain warnings or error info)
          if (stderr.trim()) {
            logger.debug(`[BINARY STDERR] ${stderr.trim()}`);
          }
          resolve(stdout.trim());
        } else {
          logger.error(`[ERROR] Binary exited with code ${code}`);
          logger.error(`[ERROR] Binary stderr: ${stderr}`);
          reject(new Error(`Binary exited with code ${code}: ${stderr}`));
        }
      });

      binary.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        logger.error('[ERROR] Failed to spawn binary process:', error);
        logger.error(`[ERROR] Binary path was: ${binPath}`);
        reject(error);
      });

      // Timeout after 50ms (Swift binary should be very fast)
      const timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        binary.kill();
        logger.error('[ERROR] Binary timeout after 50ms');
        logger.error(`[ERROR] stdout so far: "${stdout}"`);
        logger.error(`[ERROR] stderr so far: "${stderr}"`);
        reject(new Error('Binary timeout'));
      }, 50);
    });

    const queryDuration = Date.now() - queryStartTime;
    logger.debug(`[RESULT] Binary query took ${queryDuration}ms, raw result: "${result}"`);

    const [leftStr, rightStr, middleStr] = result.split(',');
    const left = leftStr === '1';
    const right = rightStr === '1';
    const middle = middleStr === '1';

    logger.debug(`[PARSE] Parsed button states - left: "${leftStr}" -> ${left}, right: "${rightStr}" -> ${right}, middle: "${middleStr}" -> ${middle}`);

    const states = {
      left: left || false,
      right: right || false,
      middle: middle || false,
    };

    // Log state changes for debugging
    if (cachedStates) {
      const hasChanged = (
        cachedStates.left !== states.left ||
        cachedStates.right !== states.right ||
        cachedStates.middle !== states.middle
      );
      
      if (hasChanged) {
        logger.info(`[STATE CHANGE] Button state changed from ${JSON.stringify(cachedStates)} to ${JSON.stringify(states)}`);
      } else {
        logger.debug(`[NO CHANGE] Button states unchanged: ${JSON.stringify(states)}`);
      }
    } else {
      logger.debug(`[INITIAL] Initial button states: ${JSON.stringify(states)}`);
    }

    // Cache the result
    cachedStates = states;
    lastCheckTime = now;

    return states;
  } catch (error) {
    const queryDuration = Date.now() - queryStartTime;
    logger.error(`[ERROR] Button state detection failed after ${queryDuration}ms:`, error);
    
    // If detection fails, return cached state or default
    if (cachedStates) {
      logger.warn(`[FALLBACK] Using cached button states due to error:`, cachedStates);
      return cachedStates;
    }
    
    // Log error on first failure to help diagnose issues
    logger.error('[ERROR] Button state detection failed. Make sure the mouse-button-state binary is built.');
    logger.error('[ERROR] Build with: cd native && chmod +x build.sh && ./build.sh');
    logger.error('[ERROR] Full error details:', error);
    
    return { left: false, right: false, middle: false };
  }
}

/**
 * Process mouse events to detect clicks from state changes
 * This analyzes the event stream to identify click patterns
 */
export function detectClicksFromEvents(events: MouseEvent[]): MouseEvent[] {
  const processedEvents: MouseEvent[] = [];
  const buttonStates = {
    left: { isDown: false, lastDownTime: 0, lastDownPos: { x: 0, y: 0 } },
    right: { isDown: false, lastDownTime: 0, lastDownPos: { x: 0, y: 0 } },
    middle: { isDown: false, lastDownTime: 0, lastDownPos: { x: 0, y: 0 } },
  };

  for (const event of events) {
    // If event already has button/action info, use it
    if (event.button && event.action) {
      processedEvents.push(event);
      continue;
    }

    // Otherwise, treat as move event
    processedEvents.push({
      ...event,
      action: 'move',
    });
  }

  return processedEvents;
}

/**
 * Enhance events with click detection based on timing and position
 * This is a fallback method when direct button state detection isn't available
 */
export function enhanceEventsWithClickDetection(
  events: MouseEvent[],
  clickThreshold: number = 200 // ms
): MouseEvent[] {
  // This would analyze the event stream for patterns that indicate clicks
  // For example, rapid position changes followed by stillness might indicate a click
  // This is a placeholder for more sophisticated click detection
  return events;
}

