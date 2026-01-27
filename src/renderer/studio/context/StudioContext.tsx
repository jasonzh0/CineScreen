import React, { createContext, useContext, useRef, useCallback, useState } from 'react';
import type { RecordingMetadata } from '../../../types/metadata';
import type { ZoomSection } from '../../../processing/zoom-tracker';
import { useMetadata } from '../hooks/useMetadata';
import { usePlayback } from '../hooks/usePlayback';
import { useExport } from '../hooks/useExport';

interface StudioContextValue {
  // Metadata
  metadata: RecordingMetadata | null;
  videoPath: string;
  metadataPath: string;
  isLoading: boolean;
  error: string | null;
  updateMetadata: (updater: (prev: RecordingMetadata) => RecordingMetadata) => void;
  saveMetadata: () => Promise<boolean>;
  reloadMetadata: () => Promise<boolean>;

  // Video ref
  videoRef: React.RefObject<HTMLVideoElement | null>;

  // Playback
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  play: () => Promise<void>;
  pause: () => void;
  togglePlayPause: () => void;
  seekTo: (time: number) => void;
  skipForward: (seconds?: number) => void;
  skipBackward: (seconds?: number) => void;
  stepFrame: (direction: 1 | -1) => void;

  // Export
  isExporting: boolean;
  exportProgress: number;
  exportMessage: string;
  exportVideo: () => Promise<{ success: boolean; outputPath?: string; error?: string }>;

  // Zoom sections
  selectedZoomSection: number | null;
  setSelectedZoomSection: (startTime: number | null) => void;
  addZoomSection: (startTime: number, endTime: number, scale: number, centerX: number, centerY: number) => void;
  removeZoomSection: (startTime: number) => void;
  updateZoomSection: (startTime: number, updates: Partial<ZoomSection>) => void;

  // Toast
  showToast: (message: string, type?: 'success' | 'error') => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selectedZoomSection, setSelectedZoomSection] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const {
    metadata,
    videoPath,
    metadataPath,
    isLoading,
    error,
    updateMetadata,
    saveMetadata,
    reloadMetadata,
  } = useMetadata();

  const playback = usePlayback(videoRef);

  const {
    isExporting,
    progress: exportProgress,
    progressMessage: exportMessage,
    exportVideo,
  } = useExport(videoPath, metadataPath, metadata);

  const addZoomSection = useCallback((
    startTime: number,
    endTime: number,
    scale: number,
    centerX: number,
    centerY: number
  ) => {
    updateMetadata(prev => ({
      ...prev,
      zoom: {
        ...prev.zoom,
        sections: [
          ...(prev.zoom.sections || []),
          { startTime, endTime, scale, centerX, centerY },
        ].sort((a, b) => a.startTime - b.startTime),
      },
    }));
  }, [updateMetadata]);

  const removeZoomSection = useCallback((startTime: number) => {
    updateMetadata(prev => ({
      ...prev,
      zoom: {
        ...prev.zoom,
        sections: (prev.zoom.sections || []).filter(s => s.startTime !== startTime),
      },
    }));
    if (selectedZoomSection === startTime) {
      setSelectedZoomSection(null);
    }
  }, [updateMetadata, selectedZoomSection]);

  const updateZoomSection = useCallback((startTime: number, updates: Partial<ZoomSection>) => {
    updateMetadata(prev => ({
      ...prev,
      zoom: {
        ...prev.zoom,
        sections: (prev.zoom.sections || []).map(s =>
          s.startTime === startTime ? { ...s, ...updates } : s
        ),
      },
    }));
  }, [updateMetadata]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  const value: StudioContextValue = {
    metadata,
    videoPath,
    metadataPath,
    isLoading,
    error,
    updateMetadata,
    saveMetadata,
    reloadMetadata,
    videoRef,
    ...playback,
    isExporting,
    exportProgress,
    exportMessage,
    exportVideo,
    selectedZoomSection,
    setSelectedZoomSection,
    addZoomSection,
    removeZoomSection,
    updateZoomSection,
    showToast,
  };

  return (
    <StudioContext.Provider value={value}>
      {children}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-lg text-sm font-medium text-white
                     shadow-[0_4px_12px_rgba(0,0,0,0.4)] border transition-all duration-200
                     ${toastMessage.type === 'success' ? 'bg-neutral-900 border-green-500/30' : 'bg-neutral-900 border-red-500/30'}`}
        >
          {toastMessage.message}
        </div>
      )}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) {
    throw new Error('useStudio must be used within a StudioProvider');
  }
  return context;
}
