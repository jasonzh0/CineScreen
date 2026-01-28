/**
 * Cursor asset path resolution for Node.js environment
 * Used by the processing pipeline (Sharp-based cursor rendering)
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { CURSOR_SHAPE_MAP } from './constants';

// Create a simple logger function to avoid circular dependencies
function logDebug(message: string, ...args: unknown[]): void {
  if (process.env.DEBUG_CURSOR) {
    console.log(`[CursorAssets] ${message}`, ...args);
  }
}

function logWarn(message: string, ...args: unknown[]): void {
  console.warn(`[CursorAssets] ${message}`, ...args);
}

/**
 * Get the assets directory path based on environment
 * Internal function - not exported from module
 */
function getAssetsDir(): string {
  // Try to get app from electron, but handle case where it's not available
  let app: { isPackaged: boolean; getPath: (name: string) => string } | undefined;
  try {
    app = require('electron').app;
  } catch {
    // Electron not available, assume development
  }

  const isDev = process.env.NODE_ENV === 'development' || !app?.isPackaged;
  logDebug('Getting assets directory, isDev:', isDev, '__dirname:', __dirname, 'cwd:', process.cwd());

  if (isDev) {
    // In development, try multiple possible paths
    // __dirname in compiled code will be dist/main/cursor or dist/cursor
    const possiblePaths = [
      join(__dirname, '../../src/assets'), // From dist/main/cursor
      join(__dirname, '../../../src/assets'), // From dist/cursor
      join(process.cwd(), 'src/assets'), // From project root
    ];

    logDebug('Trying possible asset paths:', possiblePaths);

    for (const path of possiblePaths) {
      logDebug('Checking path:', path, 'exists:', existsSync(path));
      if (existsSync(path)) {
        logDebug('Found assets directory at:', path);
        return path;
      }
    }

    // Fallback to project root
    const fallbackPath = join(process.cwd(), 'src/assets');
    logDebug('Using fallback path:', fallbackPath);
    return fallbackPath;
  }

  // In production, use app resources
  const possibleProdPaths: string[] = [];

  if (app) {
    try {
      const resourcesPath = app.getPath('resources');
      possibleProdPaths.push(join(resourcesPath, 'assets'));
      logDebug('Added path from app.getPath("resources"):', join(resourcesPath, 'assets'));
    } catch (error) {
      logDebug('Could not get resources path:', error);
    }

    try {
      const exePath = app.getPath('exe');
      possibleProdPaths.push(join(exePath, '../../Resources/assets'));
      logDebug('Added path from exe calculation:', join(exePath, '../../Resources/assets'));
    } catch (error) {
      logDebug('Could not get exe path:', error);
    }
  }

  // Calculate from __dirname
  const fromDistPath = join(__dirname, '../../../../assets');
  possibleProdPaths.push(fromDistPath);
  logDebug('Added path from __dirname (4 levels up):', fromDistPath);

  const fromDistPathAlt = join(__dirname, '../../../../../assets');
  possibleProdPaths.push(fromDistPathAlt);
  logDebug('Added alternative __dirname path (5 levels up):', fromDistPathAlt);

  // Check each path and return the first one that exists
  for (const path of possibleProdPaths) {
    logDebug('Checking production path:', path, 'exists:', existsSync(path));
    if (existsSync(path)) {
      logDebug('Found production assets directory at:', path);
      return path;
    }
  }

  // If none found, return the first calculated path (will be checked by caller)
  const fallbackPath = possibleProdPaths[0] || join(process.cwd(), 'resources/assets');
  logWarn('No production assets directory found, using fallback:', fallbackPath);
  return fallbackPath;
}

/**
 * Get cursor asset file path for a given shape
 * Internal function - used by getCursorAssetFilePath
 * @returns Full path to the asset file, or null if not found
 */
function getCursorAssetPath(shape: string): string | null {
  const assetFileName = CURSOR_SHAPE_MAP[shape] || CURSOR_SHAPE_MAP.arrow;
  const assetsDir = getAssetsDir();
  const assetPath = join(assetsDir, assetFileName);

  logDebug('Getting cursor asset for shape:', shape, 'file:', assetFileName, 'path:', assetPath);

  if (existsSync(assetPath)) {
    logDebug('Cursor asset found at:', assetPath);
    return assetPath;
  }

  logDebug('Cursor asset not found at:', assetPath);
  return null;
}

/**
 * Get cursor asset file path with fallback verification
 * Tries multiple possible locations
 */
export function getCursorAssetFilePath(shape: string): string | null {
  logDebug('getCursorAssetFilePath called for shape:', shape);
  const path = getCursorAssetPath(shape);

  if (path) {
    // Verify the file actually exists
    if (existsSync(path)) {
      logDebug('Cursor asset file verified at:', path);
      return path;
    } else {
      logWarn('Cursor asset path resolved but file does not exist:', path);
      // Try to find it in common locations
      const assetFileName = CURSOR_SHAPE_MAP[shape] || CURSOR_SHAPE_MAP.arrow;
      const fallbackPaths = [
        join(process.cwd(), 'src/assets', assetFileName),
        join(__dirname, '../../src/assets', assetFileName),
        join(__dirname, '../../../src/assets', assetFileName),
      ];

      logDebug('Trying fallback paths:', fallbackPaths);

      for (const fallbackPath of fallbackPaths) {
        logDebug('Checking fallback path:', fallbackPath, 'exists:', existsSync(fallbackPath));
        if (existsSync(fallbackPath)) {
          logDebug('Found cursor asset at fallback path:', fallbackPath);
          return fallbackPath;
        }
      }

      logWarn('Could not find cursor asset in any fallback path');
    }
  } else {
    logWarn('getCursorAssetPath returned null for shape:', shape);
  }

  return null;
}
