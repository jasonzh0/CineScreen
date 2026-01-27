import React, { useState, useCallback } from 'react';
import { Button } from '../../shared/components';
import { useElectronAPI } from '../../shared/hooks/useElectronAPI';

interface RecordingControlsProps {
  isRecording: boolean;
  canRecord: boolean;
  onStartRecording: (outputPath: string) => Promise<boolean>;
  lastRecording: { outputPath: string; metadataPath?: string } | null;
  onClearLastRecording: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export function RecordingControls({
  isRecording,
  canRecord,
  onStartRecording,
  lastRecording,
  onClearLastRecording,
  showToast,
}: RecordingControlsProps) {
  const api = useElectronAPI();
  const [statusText, setStatusText] = useState('Ready to record');

  const handleStartRecording = useCallback(async () => {
    if (isRecording || !api) return;

    // Select output path if not already set
    const outputPath = await api.selectOutputPath?.();
    if (!outputPath) {
      showToast('Please select an output path', 'warning');
      return;
    }

    setStatusText('Starting recording...');
    const success = await onStartRecording(outputPath);

    if (success) {
      setStatusText('Recording...');
    } else {
      setStatusText('Failed to start recording');
      showToast('Failed to start recording', 'error');
    }
  }, [api, isRecording, onStartRecording, showToast]);

  const handleOpenStudio = useCallback(async () => {
    if (!lastRecording?.metadataPath || !api?.openStudio) return;

    try {
      await api.openStudio(lastRecording.outputPath, lastRecording.metadataPath);
      onClearLastRecording();
    } catch (error) {
      console.error('Failed to open studio:', error);
      showToast('Failed to open studio', 'error');
    }
  }, [api, lastRecording, onClearLastRecording, showToast]);

  const handleOpenStudioWithFiles = useCallback(async () => {
    if (!api?.selectVideoFile || !api?.selectMetadataFile || !api?.openStudio) return;

    try {
      const videoPath = await api.selectVideoFile();
      if (!videoPath) return;

      const metadataPath = await api.selectMetadataFile();
      if (!metadataPath) return;

      await api.openStudio(videoPath, metadataPath);
    } catch (error) {
      console.error('Failed to open studio:', error);
      showToast('Failed to open studio', 'error');
    }
  }, [api, showToast]);

  return (
    <div className="mt-5 pt-4 border-t border-white/[0.04]">
      <div className="mb-3">
        <span className="text-sm text-[#e0e0e0]">{statusText}</span>
      </div>

      {lastRecording?.metadataPath && (
        <Button
          variant="primary"
          className="w-full mb-3"
          onClick={handleOpenStudio}
        >
          Open in Studio
        </Button>
      )}

      <div className="flex gap-2.5">
        <Button
          variant="secondary"
          onClick={handleOpenStudioWithFiles}
        >
          Open Studio
        </Button>
        <Button
          variant="record"
          className="flex-1"
          disabled={!canRecord || isRecording}
          onClick={handleStartRecording}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="6" />
          </svg>
          Start Recording
        </Button>
      </div>
    </div>
  );
}
