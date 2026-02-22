/**
 * Studio-related IPC handlers
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createStudioWindow, getStudioWindow } from '../studio-window';
import { VideoProcessor } from '../../processing/video-processor';
import { MetadataExporter } from '../../processing/metadata-exporter';
import type { RecordingMetadata } from '../../types/metadata';
import { createLogger } from '../../utils/logger';
import { loadConfig } from '../state';

const logger = createLogger('IPC:Studio');

/**
 * Register studio-related IPC handlers
 * @param getMainWindow - Function to get main window
 */
export function registerStudioHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('open-studio', async (_, videoPath: string, metadataPath: string) => {
    logger.info('IPC: open-studio called', { videoPath, metadataPath });

    if (!existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    if (!existsSync(metadataPath)) {
      throw new Error(`Metadata file not found: ${metadataPath}`);
    }

    createStudioWindow(videoPath, metadataPath);
    return { success: true };
  });

  ipcMain.handle('load-metadata', async (_, metadataPath: string): Promise<RecordingMetadata> => {
    logger.info('IPC: load-metadata called', { metadataPath });

    if (!existsSync(metadataPath)) {
      throw new Error(`Metadata file not found: ${metadataPath}`);
    }

    return MetadataExporter.loadMetadata(metadataPath);
  });

  ipcMain.handle('get-video-info', async (_, videoPath: string) => {
    logger.info('IPC: get-video-info called', { videoPath });

    if (!existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const { getVideoDimensions } = await import('../../processing/video-utils');
    const dimensions = await getVideoDimensions(videoPath);

    // Get video duration and frame rate using FFprobe or similar
    // For now, return dimensions and estimate frame rate
    return {
      width: dimensions.width,
      height: dimensions.height,
      frameRate: parseInt(loadConfig().frameRate, 10) || 60,
      duration: 0, // Would need to extract from video metadata
    };
  });

  ipcMain.handle('export-video-from-studio', async (_, videoPath: string, metadataPath: string, metadata: RecordingMetadata) => {
    logger.info('IPC: export-video-from-studio called', { videoPath, metadataPath });

    if (!existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    if (!existsSync(metadataPath)) {
      throw new Error(`Metadata file not found: ${metadataPath}`);
    }

    const mainWindow = getMainWindow();

    // Show save dialog for output
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Video',
      defaultPath: `recording_${Date.now()}.mp4`,
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mov'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      throw new Error('Export cancelled');
    }

    const outputPath = result.filePath;

    try {
      // Process video from metadata
      const processor = new VideoProcessor();
      await processor.processVideoFromMetadata({
        inputVideo: videoPath,
        outputVideo: outputPath,
        metadata,
        onProgress: (percent, message) => {
          logger.debug(`Export progress: ${percent}% - ${message}`);
          const studioWindow = getStudioWindow();
          if (studioWindow && !studioWindow.isDestroyed()) {
            studioWindow.webContents.send('processing-progress', { percent, message });
          }
        },
      });

      logger.info('Video exported successfully');
      return {
        success: true,
        outputPath,
      };
    } catch (error) {
      logger.error('Export failed:', error);
      throw error;
    }
  });

  // Save metadata to the original JSON file
  ipcMain.handle('save-metadata', async (_event, filePath: string, metadata: object) => {
    try {
      writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
      logger.info(`Metadata saved to: ${filePath}`);
      return { success: true };
    } catch (error) {
      logger.error('Failed to save metadata:', error);
      throw error;
    }
  });

  // Reload metadata from the original JSON file
  ipcMain.handle('reload-metadata', async (_event, filePath: string) => {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      logger.info(`Metadata reloaded from: ${filePath}`);
      return { success: true, data };
    } catch (error) {
      logger.error('Failed to reload metadata:', error);
      throw error;
    }
  });
}
