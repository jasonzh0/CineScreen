import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { createLogger } from '../utils/logger';

const logger = createLogger('StudioWindow');

let studioWindow: BrowserWindow | null = null;

const isDev = !require('electron').app.isPackaged;

/**
 * Create and show the studio window
 */
export function createStudioWindow(videoPath: string, metadataPath: string): void {
  // Close existing studio window if open
  if (studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.close();
  }

  logger.info('Creating studio window for video:', videoPath, 'metadata:', metadataPath);

  // Get preload script path
  // In dev: dist/main/renderer/preload.js
  // In prod: dist/main/renderer/preload.js (same)
  // In prod: dist/main/renderer/preload.js (same)
  const preloadPath = join(__dirname, '../renderer/preload.js');
  logger.debug('Preload path:', preloadPath);

  const iconPath = isDev
    ? join(__dirname, '../../../src/assets/icon.png')
    : join(process.resourcesPath, 'assets/icon.png');

  studioWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    show: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow loading local video files
    },
    title: 'Studio - CineScreen',
    resizable: true,
    minWidth: 1000,
    minHeight: 600,
  });

  studioWindow.once('ready-to-show', () => {
    studioWindow?.show();
  });

  // Load studio HTML with video and metadata paths as URL parameters
  const videoPathEncoded = encodeURIComponent(videoPath);
  const metadataPathEncoded = encodeURIComponent(metadataPath);

  // Define function to load from file (must be defined before use)
  const loadStudioFromFile = () => {
    if (!studioWindow || studioWindow.isDestroyed()) return;

    // Load the built HTML file
    // __dirname is dist/main/main, so we need to go up to dist/renderer
    const htmlPath = join(__dirname, '../../renderer/studio.html');
    logger.info('Loading studio from file:', htmlPath);
    logger.debug('File exists:', existsSync(htmlPath));

    if (!existsSync(htmlPath)) {
      logger.error('Studio HTML file not found at:', htmlPath);
      // Try alternative paths
      const altPaths = [
        join(__dirname, '../renderer/studio.html'),
        join(process.resourcesPath || '', 'app.asar/dist/renderer/studio.html'),
        join(process.resourcesPath || '', 'dist/renderer/studio.html'),
      ];
      for (const altPath of altPaths) {
        logger.debug('Checking alternative path:', altPath, existsSync(altPath));
        if (existsSync(altPath)) {
          logger.info('Found studio HTML at alternative path:', altPath);
          studioWindow.loadFile(altPath, {
            query: { videoPath: videoPathEncoded, metadataPath: metadataPathEncoded },
          }).catch(err => {
            logger.error('Failed to load studio file:', err);
          });
          return;
        }
      }
      logger.error('Could not find studio.html in any expected location');
      return;
    }

    studioWindow.loadFile(htmlPath, {
      query: { videoPath: videoPathEncoded, metadataPath: metadataPathEncoded },
    }).catch(err => {
      logger.error('Failed to load studio file:', err);
    });
  };

  // Load studio HTML - try dev server first if in dev mode, otherwise load from file
  // IMPORTANT: Even in dev mode, if Vite isn't running, we need to load from file
  // The issue is that when Vite isn't running, loadURL fails silently or loads blank page
  if (isDev) {
    // In dev mode, try Vite dev server first, but with immediate fallback if it fails
    const devUrl = `http://localhost:3000/studio.html?videoPath=${videoPathEncoded}&metadataPath=${metadataPathEncoded}`;
    logger.info('Attempting to load from dev server:', devUrl);

    let fallbackTriggered = false;
    const triggerFallback = () => {
      if (fallbackTriggered) return;
      fallbackTriggered = true;
      logger.info('Falling back to file-based loading');
      if (studioWindow && !studioWindow.isDestroyed()) {
        loadStudioFromFile();
      }
    };

    // Set up error handler before loading
    const failHandler = (event: any, errorCode: number, errorDescription: string) => {
      logger.warn('Failed to load from dev server:', { errorCode, errorDescription });
      triggerFallback();
    };

    // Set a timeout - if dev server doesn't respond quickly, use file
    const timeout = setTimeout(() => {
      logger.warn('Dev server timeout - using file fallback');
      if (studioWindow && !studioWindow.isDestroyed()) {
        studioWindow.webContents.removeListener('did-fail-load', failHandler);
      }
      triggerFallback();
    }, 1500);

    studioWindow.webContents.once('did-fail-load', failHandler);
    studioWindow.webContents.once('did-finish-load', () => {
      clearTimeout(timeout);
      if (studioWindow && !studioWindow.isDestroyed()) {
        studioWindow.webContents.removeListener('did-fail-load', failHandler);
      }
    });

    studioWindow.loadURL(devUrl).catch(err => {
      logger.error('Failed to load studio URL:', err);
      clearTimeout(timeout);
      if (studioWindow && !studioWindow.isDestroyed()) {
        studioWindow.webContents.removeListener('did-fail-load', failHandler);
      }
      triggerFallback();
    });
  } else {
    // In production, load from file directly
    loadStudioFromFile();
  }

  // Wait for window to be ready
  studioWindow.webContents.once('did-finish-load', () => {
    logger.info('Studio window loaded');

    // Wait a bit for DOM to be ready, then inject init data
    setTimeout(() => {
      if (!studioWindow || studioWindow.isDestroyed()) return;

      // Inject URL parameters into window for easier access
      studioWindow.webContents.executeJavaScript(`
        window.__studioInitData = {
          videoPath: decodeURIComponent('${videoPathEncoded}'),
          metadataPath: decodeURIComponent('${metadataPathEncoded}')
        };
      `).catch(err => {
        logger.error('Failed to inject init data:', err);
      });
    }, 100);
  });

  // Log any console messages from renderer
  studioWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    logger.debug(`[Renderer ${level}]:`, message);
  });

  // Log page errors
  studioWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.error('Studio window failed to load:', { errorCode, errorDescription, validatedURL });
  });

  if (isDev) {
    studioWindow.webContents.openDevTools();
  }

  studioWindow.on('closed', () => {
    logger.info('Studio window closed');
    studioWindow = null;
  });
}

/**
 * Check if studio window is open
 */
function isStudioWindowOpen(): boolean {
  return studioWindow !== null && !studioWindow.isDestroyed();
}

/**
 * Get the studio window instance
 */
export function getStudioWindow(): BrowserWindow | null {
  return studioWindow;
}

