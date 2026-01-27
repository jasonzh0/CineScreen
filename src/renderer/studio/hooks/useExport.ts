import { useState, useEffect, useCallback } from 'react';
import type { RecordingMetadata } from '../../../types/metadata';
import { useStudioAPI } from './useStudioAPI';

export function useExport(videoPath: string, metadataPath: string, metadata: RecordingMetadata | null) {
  const api = useStudioAPI();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  useEffect(() => {
    if (!api?.onProcessingProgress) return;

    api.onProcessingProgress((data) => {
      setProgress(data.percent);
      setProgressMessage(data.message);
    });

    return () => {
      api.removeProcessingProgressListener?.();
    };
  }, [api]);

  const exportVideo = useCallback(async () => {
    if (!api?.exportVideo || !metadata || !videoPath || !metadataPath) {
      return { success: false, error: 'Missing required data' };
    }

    try {
      setIsExporting(true);
      setProgress(0);
      setProgressMessage('Starting export...');

      const result = await api.exportVideo(videoPath, metadataPath, metadata);

      setProgress(100);
      setProgressMessage('Export complete!');

      return { success: true, outputPath: result.outputPath };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Export failed';
      return { success: false, error };
    } finally {
      setIsExporting(false);
    }
  }, [api, videoPath, metadataPath, metadata]);

  return {
    isExporting,
    progress,
    progressMessage,
    exportVideo,
  };
}
