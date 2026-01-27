import { useMemo } from 'react';
import type { RecordingMetadata } from '../../../types/metadata';

export interface StudioElectronAPI {
  loadMetadata: (metadataPath: string) => Promise<RecordingMetadata>;
  getVideoInfo: (videoPath: string) => Promise<{
    width: number;
    height: number;
    frameRate: number;
    duration: number;
  }>;
  exportVideo: (videoPath: string, metadataPath: string, metadata: RecordingMetadata) => Promise<{ success: boolean; outputPath: string }>;
  onProcessingProgress: (callback: (data: { percent: number; message: string }) => void) => void;
  removeProcessingProgressListener: () => void;
  saveMetadata: (filePath: string, metadata: object) => Promise<{ success: boolean }>;
  reloadMetadata: (filePath: string) => Promise<{ success: boolean; data?: RecordingMetadata }>;
}

declare global {
  interface Window {
    __studioInitData?: {
      videoPath: string;
      metadataPath: string;
    };
  }
}

export function useStudioAPI(): StudioElectronAPI | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useMemo(() => (window as any).electronAPI as StudioElectronAPI | undefined, []);
}

export function getInitPaths(): { videoPath: string; metadataPath: string } | null {
  // Try URL parameters first
  const urlParams = new URLSearchParams(window.location.search);
  const videoPathParam = urlParams.get('videoPath');
  const metadataPathParam = urlParams.get('metadataPath');

  if (videoPathParam && metadataPathParam) {
    return {
      videoPath: decodeURIComponent(videoPathParam),
      metadataPath: decodeURIComponent(metadataPathParam),
    };
  }

  // Fallback to injected data
  if (window.__studioInitData) {
    return window.__studioInitData;
  }

  return null;
}
