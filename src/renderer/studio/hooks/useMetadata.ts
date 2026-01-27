import { useState, useEffect, useCallback } from 'react';
import type { RecordingMetadata } from '../../../types/metadata';
import { useStudioAPI, getInitPaths } from './useStudioAPI';

export function useMetadata() {
  const api = useStudioAPI();
  const [metadata, setMetadata] = useState<RecordingMetadata | null>(null);
  const [videoPath, setVideoPath] = useState<string>('');
  const [metadataPath, setMetadataPath] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetadata = useCallback(async () => {
    const paths = getInitPaths();
    if (!paths || !api?.loadMetadata) {
      setIsLoading(false);
      setError('No video/metadata paths provided');
      return;
    }

    setVideoPath(paths.videoPath);
    setMetadataPath(paths.metadataPath);

    try {
      setIsLoading(true);
      const data = await api.loadMetadata(paths.metadataPath);
      setMetadata(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metadata');
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  const saveMetadata = useCallback(async () => {
    if (!api?.saveMetadata || !metadata || !metadataPath) return false;

    try {
      const result = await api.saveMetadata(metadataPath, metadata);
      return result.success;
    } catch (err) {
      console.error('Failed to save metadata:', err);
      return false;
    }
  }, [api, metadata, metadataPath]);

  const reloadMetadata = useCallback(async () => {
    if (!api?.reloadMetadata || !metadataPath) return false;

    try {
      const result = await api.reloadMetadata(metadataPath);
      if (result.success && result.data) {
        setMetadata(result.data);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to reload metadata:', err);
      return false;
    }
  }, [api, metadataPath]);

  const updateMetadata = useCallback((updater: (prev: RecordingMetadata) => RecordingMetadata) => {
    setMetadata(prev => prev ? updater(prev) : null);
  }, []);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  return {
    metadata,
    videoPath,
    metadataPath,
    isLoading,
    error,
    setMetadata,
    updateMetadata,
    saveMetadata,
    reloadMetadata,
  };
}
