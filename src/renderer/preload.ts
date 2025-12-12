import { contextBridge, ipcRenderer } from 'electron';
import type { RecordingConfig, CursorConfig, ZoomConfig, MouseEffectsConfig, PermissionStatus, RecordingState } from '../types';
import type { RecordingMetadata } from '../types/metadata';

const electronAPI = {
  checkPermissions: (): Promise<PermissionStatus> =>
    ipcRenderer.invoke('check-permissions'),

  requestPermissions: (): Promise<void> =>
    ipcRenderer.invoke('request-permissions'),

  startRecording: (config: RecordingConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('start-recording', config),

  stopRecording: (config: {
    cursorConfig: CursorConfig;
    zoomConfig?: ZoomConfig;
    mouseEffectsConfig?: MouseEffectsConfig;
  }): Promise<{ success: boolean; outputPath: string; metadataPath?: string }> =>
    ipcRenderer.invoke('stop-recording', config),

  getRecordingState: (): Promise<RecordingState> =>
    ipcRenderer.invoke('get-recording-state'),

  selectOutputPath: (): Promise<string | null> =>
    ipcRenderer.invoke('select-output-path'),

  onDebugLog: (callback: (message: string) => void) => {
    ipcRenderer.on('debug-log', (_event, message: string) => callback(message));
  },

  removeDebugLogListener: () => {
    ipcRenderer.removeAllListeners('debug-log');
  },

  onProcessingProgress: (callback: (data: { percent: number; message: string }) => void) => {
    ipcRenderer.on('processing-progress', (_event, data) => callback(data));
  },

  removeProcessingProgressListener: () => {
    ipcRenderer.removeAllListeners('processing-progress');
  },

  // Studio-specific IPC methods
  openStudio: (videoPath: string, metadataPath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-studio', videoPath, metadataPath),

  selectVideoFile: (): Promise<string | null> =>
    ipcRenderer.invoke('select-video-file'),

  selectMetadataFile: (): Promise<string | null> =>
    ipcRenderer.invoke('select-metadata-file'),

  loadMetadata: (metadataPath: string): Promise<RecordingMetadata> =>
    ipcRenderer.invoke('load-metadata', metadataPath),

  getVideoInfo: (videoPath: string): Promise<{
    width: number;
    height: number;
    frameRate: number;
    duration: number;
  }> =>
    ipcRenderer.invoke('get-video-info', videoPath),

  exportVideo: (videoPath: string, metadataPath: string, metadata: RecordingMetadata): Promise<{ success: boolean; outputPath: string }> =>
    ipcRenderer.invoke('export-video-from-studio', videoPath, metadataPath, metadata),

  saveMetadata: (filePath: string, metadata: object): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('save-metadata', filePath, metadata),

  reloadMetadata: (filePath: string): Promise<{ success: boolean; data?: RecordingMetadata }> =>
    ipcRenderer.invoke('reload-metadata', filePath),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

