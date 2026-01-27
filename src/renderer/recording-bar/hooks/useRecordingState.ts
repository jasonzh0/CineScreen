import { useState, useEffect, useCallback } from 'react';

interface RecordingBarState {
  isRecording: boolean;
  elapsedMs: number;
}

interface RecordingBarAPI {
  stopRecording: () => Promise<void>;
  restartRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  onRecordingStateUpdate: (callback: (state: RecordingBarState) => void) => void;
  onRecordingTimerUpdate: (callback: (elapsedMs: number) => void) => void;
}

declare global {
  interface Window {
    recordingBarAPI?: RecordingBarAPI;
  }
}

export function useRecordingState() {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isRecording, setIsRecording] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const api = window.recordingBarAPI;
    if (!api) {
      console.error('recordingBarAPI not available');
      return;
    }

    api.onRecordingStateUpdate((state: RecordingBarState) => {
      setElapsedMs(state.elapsedMs);
      setIsRecording(state.isRecording);
    });

    api.onRecordingTimerUpdate((elapsed: number) => {
      setElapsedMs(elapsed);
    });
  }, []);

  const stop = useCallback(async () => {
    const api = window.recordingBarAPI;
    if (!api) return;

    setIsLoading(true);
    try {
      await api.stopRecording();
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const restart = useCallback(async () => {
    const api = window.recordingBarAPI;
    if (!api) return;

    setIsLoading(true);
    try {
      await api.restartRecording();
    } catch (error) {
      console.error('Failed to restart recording:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    const api = window.recordingBarAPI;
    if (!api) return;

    setIsLoading(true);
    try {
      await api.cancelRecording();
    } catch (error) {
      console.error('Failed to cancel recording:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    elapsedMs,
    isRecording,
    isLoading,
    stop,
    restart,
    cancel,
  };
}
