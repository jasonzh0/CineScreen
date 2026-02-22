import { useState, useEffect, useCallback } from 'react';
import type { RecordingMetadata } from '../../../types/metadata';
import { useStudioAPI, getInitPaths } from './useStudioAPI';
import { DEFAULT_EFFECTS } from '../../../utils/constants';

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
      data.effects = {
        ...DEFAULT_EFFECTS,
        ...data.effects,
        clickCircles: { ...DEFAULT_EFFECTS.clickCircles, ...data.effects?.clickCircles },
        trail: { ...DEFAULT_EFFECTS.trail, ...data.effects?.trail },
        highlightRing: { ...DEFAULT_EFFECTS.highlightRing, ...data.effects?.highlightRing },
      };
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
        result.data.effects = {
          ...DEFAULT_EFFECTS,
          ...result.data.effects,
          clickCircles: { ...DEFAULT_EFFECTS.clickCircles, ...result.data.effects?.clickCircles },
          trail: { ...DEFAULT_EFFECTS.trail, ...result.data.effects?.trail },
          highlightRing: { ...DEFAULT_EFFECTS.highlightRing, ...result.data.effects?.highlightRing },
        };
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
