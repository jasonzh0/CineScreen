import React, { useCallback } from 'react';
import { Button } from '../../shared/components';
import { useElectronAPI } from '../../shared/hooks/useElectronAPI';

interface RecordingControlsProps {
  showToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export function RecordingControls({ showToast }: RecordingControlsProps) {
  const api = useElectronAPI();

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
      <Button
        variant="primary"
        className="w-full"
        onClick={handleOpenStudioWithFiles}
      >
        Open Studio
      </Button>
    </div>
  );
}
