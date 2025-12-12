import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CursorConfig } from '../types';
import { createLogger } from '../utils/logger';
import { DEFAULT_CURSOR_SIZE } from '../utils/constants';

// Create logger for cursor renderer
const logger = createLogger('CursorRenderer');

/**
 * Local cursor assets directory
 */
function getAssetsDir(): string {
  // Try to get app from electron, but handle case where it's not available
  let app: any;
  try {
    app = require('electron').app;
  } catch {
    // Electron not available, assume development
  }
  
  const isDev = process.env.NODE_ENV === 'development' || !app?.isPackaged;
  logger.debug('Getting assets directory, isDev:', isDev, '__dirname:', __dirname, 'cwd:', process.cwd());
  
  if (isDev) {
    // In development, try multiple possible paths
    // __dirname in compiled code will be dist/main/processing or dist/processing
    const possiblePaths = [
      join(__dirname, '../../src/assets'), // From dist/main/processing
      join(__dirname, '../../../src/assets'), // From dist/processing
      join(process.cwd(), 'src/assets'), // From project root
    ];
    
    logger.debug('Trying possible asset paths:', possiblePaths);
    
    for (const path of possiblePaths) {
      logger.debug('Checking path:', path, 'exists:', existsSync(path));
      if (existsSync(path)) {
        logger.debug('Found assets directory at:', path);
        return path;
      }
    }
    
    // Fallback to project root
    const fallbackPath = join(process.cwd(), 'src/assets');
    logger.debug('Using fallback path:', fallbackPath);
    return fallbackPath;
  }
  
  // In production, use app resources
  // In Electron, assets should be in Contents/Resources/assets
  // __dirname is in Contents/Resources/app.asar/dist/main/processing
  // So we need to go up to Contents/Resources/ and then to assets
  
  // Try multiple production paths
  const possibleProdPaths: string[] = [];
  
  if (app) {
    try {
      // Method 1: Use app.getPath('resources') - Electron's standard way
      const resourcesPath = app.getPath('resources');
      possibleProdPaths.push(join(resourcesPath, 'assets'));
      logger.debug('Added path from app.getPath("resources"):', join(resourcesPath, 'assets'));
    } catch (error) {
      logger.debug('Could not get resources path:', error);
    }
    
    try {
      // Method 2: Calculate from executable path
      // exePath is Contents/MacOS/AppName, so ../../Resources/assets
      const exePath = app.getPath('exe');
      possibleProdPaths.push(join(exePath, '../../Resources/assets'));
      logger.debug('Added path from exe calculation:', join(exePath, '../../Resources/assets'));
    } catch (error) {
      logger.debug('Could not get exe path:', error);
    }
  }
  
  // Method 3: Calculate from __dirname (most reliable in packaged apps)
  // __dirname is in Contents/Resources/app.asar/dist/main/processing
  // To get to Contents/Resources/assets:
  //   ../ = dist/main/
  //   ../../ = dist/
  //   ../../../ = app.asar/
  //   ../../../../ = Resources/
  //   ../../../../assets = Resources/assets
  const fromDistPath = join(__dirname, '../../../../assets');
  possibleProdPaths.push(fromDistPath);
  logger.debug('Added path from __dirname (4 levels up):', fromDistPath);
  
  // Method 4: Also try 5 levels up (in case structure is different)
  const fromDistPathAlt = join(__dirname, '../../../../../assets');
  possibleProdPaths.push(fromDistPathAlt);
  logger.debug('Added alternative __dirname path (5 levels up):', fromDistPathAlt);
  
  // Check each path and return the first one that exists
  for (const path of possibleProdPaths) {
    logger.debug('Checking production path:', path, 'exists:', existsSync(path));
    if (existsSync(path)) {
      logger.debug('Found production assets directory at:', path);
      return path;
    }
  }
  
  // If none found, return the first calculated path (will be checked by caller)
  const fallbackPath = possibleProdPaths[0] || join(process.cwd(), 'resources/assets');
  logger.warn('No production assets directory found, using fallback:', fallbackPath);
  return fallbackPath;
}

/**
 * Map cursor shape names to asset file names
 * Includes all system cursor types detected by cursor-type binary
 */
const CURSOR_SHAPE_MAP: Record<string, string> = {
  // Standard cursors
  arrow: 'cursor.svg',
  pointer: 'pointinghand.svg',
  hand: 'openhand.svg',
  openhand: 'openhand.svg',
  closedhand: 'closedhand.svg',
  crosshair: 'cursor.svg', // Use cursor as fallback
  ibeam: 'cursor.svg', // Text cursor - use arrow as fallback
  ibeamvertical: 'cursor.svg',

  // Resize cursors
  move: 'move.svg',
  resizeleft: 'resizenortheastsouthwest.svg',
  resizeright: 'resizenortheastsouthwest.svg',
  resizeleftright: 'resizenortheastsouthwest.svg',
  resizeup: 'resizenortheastsouthwest.svg',
  resizedown: 'resizenortheastsouthwest.svg',
  resizeupdown: 'resizenortheastsouthwest.svg',
  resize: 'resizenortheastsouthwest.svg',

  // Action cursors
  copy: 'copy.svg',
  dragcopy: 'copy.svg',
  draglink: 'cursor.svg',
  help: 'help.svg',
  notallowed: 'notallowed.svg',
  contextmenu: 'cursor.svg',
  poof: 'poof.svg',

  // Screenshot/zoom cursors
  screenshot: 'screenshotselection.svg',
  zoomin: 'zoomin.svg',
  zoomout: 'zoomout.svg',
};

/**
 * Get cursor asset path for a given shape
 */
export function getCursorAssetPath(shape: string): string | null {
  const assetFileName = CURSOR_SHAPE_MAP[shape] || CURSOR_SHAPE_MAP.arrow;
  const assetsDir = getAssetsDir();
  const assetPath = join(assetsDir, assetFileName);
  
  logger.debug('Getting cursor asset for shape:', shape, 'file:', assetFileName, 'path:', assetPath);
  
  if (existsSync(assetPath)) {
    logger.debug('Cursor asset found at:', assetPath);
    return assetPath;
  }
  
  logger.debug('Cursor asset not found at:', assetPath);
  return null;
}

/**
 * Load and scale SVG cursor from assets
 */
function loadAndScaleSVGCursor(assetPath: string, targetSize: number): string {
  try {
    const svgContent = readFileSync(assetPath, 'utf-8');
    
    // Parse SVG to get original dimensions
    const widthMatch = svgContent.match(/width="([^"]+)"/);
    const heightMatch = svgContent.match(/height="([^"]+)"/);
    const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
    
    let originalWidth = 20;
    let originalHeight = 20;
    
    if (viewBoxMatch) {
      const viewBox = viewBoxMatch[1].split(/\s+/);
      if (viewBox.length >= 4) {
        originalWidth = parseFloat(viewBox[2]) || 20;
        originalHeight = parseFloat(viewBox[3]) || 20;
      }
    } else if (widthMatch && heightMatch) {
      originalWidth = parseFloat(widthMatch[1]) || 20;
      originalHeight = parseFloat(heightMatch[1]) || 20;
    }
    
    // Calculate scale factor
    const scale = targetSize / Math.max(originalWidth, originalHeight);
    const scaledWidth = originalWidth * scale;
    const scaledHeight = originalHeight * scale;
    
    // Replace dimensions in SVG
    let scaledSVG = svgContent
      .replace(/width="[^"]+"/, `width="${scaledWidth}"`)
      .replace(/height="[^"]+"/, `height="${scaledHeight}"`);
    
    // Add transform if viewBox exists, or update viewBox
    if (viewBoxMatch) {
      // Keep viewBox, just scale the output
      scaledSVG = scaledSVG.replace(
        /<svg([^>]*)>/,
        `<svg$1 width="${scaledWidth}" height="${scaledHeight}">`
      );
    } else {
      // Add viewBox for proper scaling
      scaledSVG = scaledSVG.replace(
        /<svg([^>]*)>/,
        `<svg$1 viewBox="0 0 ${originalWidth} ${originalHeight}" width="${scaledWidth}" height="${scaledHeight}">`
      );
    }
    
    return scaledSVG;
  } catch (error) {
    logger.error('Error loading cursor SVG:', error);
    return '';
  }
}

/**
 * Generate SVG cursor based on shape and size
 * Loads from local assets if available, otherwise generates SVG
 */
export function generateCursorSVG(config: CursorConfig | undefined): string {
  // Provide default config if undefined
  if (!config) {
    config = {
      size: DEFAULT_CURSOR_SIZE,
      shape: 'arrow',
      color: '#000000',
    };
  }
  
  const { size, shape, color = '#000000' } = config;

  // Try to load from local assets first
  const assetPath = getCursorAssetPath(shape);
  if (assetPath && existsSync(assetPath)) {
    const scaledSVG = loadAndScaleSVGCursor(assetPath, size);
    if (scaledSVG) {
      // Apply color if needed (for cursors that support color changes)
      // Most SVG cursors have their own colors, so we might skip this
      return scaledSVG;
    }
  }

  // Fall back to generated SVG cursors
  switch (shape) {
    case 'arrow':
      return generateArrowCursor(size, color);
    case 'pointer':
      return generatePointerCursor(size, color);
    case 'hand':
      return generateHandCursor(size, color);
    case 'crosshair':
      return generateCrosshairCursor(size, color);
    default:
      return generateArrowCursor(size, color);
  }
}

/**
 * Generate arrow cursor SVG
 */
function generateArrowCursor(size: number, color: string): string {
  const scale = size / 20;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L ${16 * scale} ${4 * scale} L ${12 * scale} ${8 * scale} L ${18 * scale} ${14 * scale} L ${14 * scale} ${16 * scale} L ${8 * scale} ${10 * scale} L ${4 * scale} ${16 * scale} Z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Generate pointer cursor SVG
 */
function generatePointerCursor(size: number, color: string): string {
  const scale = size / 20;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <path d="M ${2 * scale} ${2 * scale} L ${14 * scale} ${2 * scale} L ${14 * scale} ${8 * scale} L ${18 * scale} ${8 * scale} L ${10 * scale} ${18 * scale} L ${8 * scale} ${14 * scale} L ${2 * scale} ${14 * scale} Z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Generate hand cursor SVG
 */
function generateHandCursor(size: number, color: string): string {
  const scale = size / 20;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <path d="M ${4 * scale} ${2 * scale} Q ${2 * scale} ${4 * scale} ${2 * scale} ${6 * scale} L ${2 * scale} ${12 * scale} Q ${2 * scale} ${14 * scale} ${4 * scale} ${14 * scale} L ${6 * scale} ${14 * scale} L ${6 * scale} ${16 * scale} Q ${6 * scale} ${18 * scale} ${8 * scale} ${18 * scale} L ${12 * scale} ${18 * scale} Q ${14 * scale} ${18 * scale} ${14 * scale} ${16 * scale} L ${14 * scale} ${10 * scale} L ${16 * scale} ${8 * scale} Q ${18 * scale} ${8 * scale} ${18 * scale} ${6 * scale} L ${18 * scale} ${4 * scale} Q ${18 * scale} ${2 * scale} ${16 * scale} ${2 * scale} Z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Generate crosshair cursor SVG
 */
function generateCrosshairCursor(size: number, color: string): string {
  const scale = size / 20;
  const center = 10 * scale;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${center}" y1="${2 * scale}" x2="${center}" y2="${8 * scale}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <line x1="${center}" y1="${12 * scale}" x2="${center}" y2="${18 * scale}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <line x1="${2 * scale}" y1="${center}" x2="${8 * scale}" y2="${center}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <line x1="${12 * scale}" y1="${center}" x2="${18 * scale}" y2="${center}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <circle cx="${center}" cy="${center}" r="${1.5 * scale}" 
              fill="${color}" 
              stroke="#ffffff" 
              stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Get cursor asset file path (for direct file access if needed)
 */
export function getCursorAssetFilePath(shape: string): string | null {
  logger.debug('getCursorAssetFilePath called for shape:', shape);
  const path = getCursorAssetPath(shape);
  
  if (path) {
    // Verify the file actually exists
    if (existsSync(path)) {
      logger.debug('Cursor asset file verified at:', path);
      return path;
    } else {
      logger.warn('Cursor asset path resolved but file does not exist:', path);
      // Try to find it in common locations
      const assetFileName = CURSOR_SHAPE_MAP[shape] || CURSOR_SHAPE_MAP.arrow;
      const fallbackPaths = [
        join(process.cwd(), 'src/assets', assetFileName),
        join(__dirname, '../../src/assets', assetFileName),
        join(__dirname, '../../../src/assets', assetFileName),
      ];
      
      logger.debug('Trying fallback paths:', fallbackPaths);
      
      for (const fallbackPath of fallbackPaths) {
        logger.debug('Checking fallback path:', fallbackPath, 'exists:', existsSync(fallbackPath));
        if (existsSync(fallbackPath)) {
          logger.debug('Found cursor asset at fallback path:', fallbackPath);
          return fallbackPath;
        }
      }
      
      logger.error('Could not find cursor asset in any fallback path');
    }
  } else {
    logger.error('getCursorAssetPath returned null for shape:', shape);
  }
  
  return null;
}


