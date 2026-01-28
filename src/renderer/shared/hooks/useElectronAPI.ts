import { useMemo } from 'react';
import type {
  RecordingConfig,
  CursorConfig,
  ZoomConfig,
  DetailedPermissionStatus,
  PermissionRequestResult,
  SystemPreferencesPanel,
} from '../../../types';

export interface ElectronAPI {
  checkPermissions: () => Promise<{
    screenRecording: boolean;
    accessibility: boolean;
    microphone: boolean;
  }>;
  requestPermissions: () => Promise<void>;
  getDetailedPermissions: () => Promise<DetailedPermissionStatus>;
  requestPermission: (type: 'screen-recording' | 'accessibility' | 'microphone') => Promise<PermissionRequestResult>;
  openSystemPreferences: (panel: SystemPreferencesPanel) => Promise<void>;
  startRecording: (config: RecordingConfig) => Promise<{ success: boolean }>;
  stopRecording: (config: {
    cursorConfig: CursorConfig;
    zoomConfig?: ZoomConfig;
  }) => Promise<{ success: boolean; outputPath: string; metadataPath?: string }>;
  getRecordingState: () => Promise<{
    isRecording: boolean;
    startTime?: number;
    outputPath?: string;
  }>;
  selectOutputPath: () => Promise<string | null>;
  setOutputPath: (path: string | null) => Promise<{ success: boolean }>;
  getOutputPath: () => Promise<string | null>;
  onDebugLog: (callback: (message: string) => void) => void;
  removeDebugLogListener: () => void;
  onProcessingProgress: (callback: (data: { percent: number; message: string }) => void) => void;
  removeProcessingProgressListener: () => void;
  openStudio: (videoPath: string, metadataPath: string) => Promise<{ success: boolean }>;
  selectVideoFile: () => Promise<string | null>;
  selectMetadataFile: () => Promise<string | null>;
  onRecordingCompleted: (callback: (data: { success: boolean; outputPath: string; metadataPath?: string }) => void) => void;
  onRestartRecording: (callback: (config: RecordingConfig) => void) => void;
  onRecordingCancelled: (callback: () => void) => void;
  onShowToast: (callback: (data: { message: string; type: 'success' | 'error' | 'info' | 'warning' }) => void) => void;
  removeRecordingBarListeners: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function useElectronAPI(): ElectronAPI | undefined {
  return useMemo(() => window.electronAPI, []);
}
