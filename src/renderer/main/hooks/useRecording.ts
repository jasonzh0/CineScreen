import { useState, useEffect, useCallback } from 'react';
import type { RecordingConfig } from '../../../types';
import { DEFAULT_FRAME_RATE } from '../../../utils/constants';
import { useElectronAPI } from '../../shared/hooks/useElectronAPI';

interface RecordingResult {
  success: boolean;
  outputPath: string;
  metadataPath?: string;
}

export function useRecording() {
  const api = useElectronAPI();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastRecording, setLastRecording] = useState<RecordingResult | null>(null);

  const startRecording = useCallback(async (outputPath: string) => {
    if (!api?.startRecording || isRecording) return false;

    const config: RecordingConfig = {
      outputPath,
      frameRate: DEFAULT_FRAME_RATE,
      quality: 'medium',
    };

    try {
      await api.startRecording(config);
      setIsRecording(true);
      return true;
    } catch (error) {
      console.error('Error starting recording:', error);
      return false;
    }
  }, [api, isRecording]);

  // Listen for recording events from the recording bar
  useEffect(() => {
    if (!api) return;

    api.onRecordingCompleted((data) => {
      setIsRecording(false);
      setIsProcessing(false);
      setLastRecording(data);
    });

    api.onRestartRecording(async (config) => {
      try {
        await api.startRecording(config);
        setIsRecording(true);
      } catch (error) {
        console.error('Error restarting recording:', error);
      }
    });

    api.onRecordingCancelled(() => {
      setIsRecording(false);
      setIsProcessing(false);
      setLastRecording(null);
    });

    return () => {
      api.removeRecordingBarListeners();
    };
  }, [api]);

  // Poll recording state periodically
  useEffect(() => {
    if (!api?.getRecordingState) return;

    const pollState = async () => {
      try {
        const state = await api.getRecordingState();
        if (state.isRecording !== isRecording) {
          setIsRecording(state.isRecording);
        }
      } catch (error) {
        // Ignore errors
      }
    };

    const interval = setInterval(pollState, 1000);
    return () => clearInterval(interval);
  }, [api, isRecording]);

  return {
    isRecording,
    isProcessing,
    lastRecording,
    startRecording,
    clearLastRecording: () => setLastRecording(null),
  };
}
