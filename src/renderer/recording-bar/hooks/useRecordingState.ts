import { useState, useEffect, useCallback } from 'react';

type RecordingBarMode = 'idle' | 'recording';

interface RecordingBarState {
  isRecording: boolean;
  elapsedMs: number;
  mode: RecordingBarMode;
}

interface RecordingBarAPI {
  stopRecording: () => Promise<void>;
  restartRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  startRecording: () => Promise<void>;
  openMainWindow: () => Promise<void>;
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
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<RecordingBarMode>('idle');

  useEffect(() => {
    const api = window.recordingBarAPI;
    if (!api) {
      console.error('recordingBarAPI not available');
      return;
    }

    api.onRecordingStateUpdate((state: RecordingBarState) => {
      setElapsedMs(state.elapsedMs);
      setIsRecording(state.isRecording);
      if (state.mode) {
        setMode(state.mode);
      } else {
        // Fallback: derive mode from isRecording
        setMode(state.isRecording ? 'recording' : 'idle');
      }
    });

    api.onRecordingTimerUpdate((elapsed: number) => {
      setElapsedMs(elapsed);
    });
  }, []);

  const startRecording = useCallback(async () => {
    const api = window.recordingBarAPI;
    if (!api) return;

    setIsLoading(true);
    try {
      await api.startRecording();
    } catch (error) {
      console.error('Failed to start recording:', error);
    } finally {
      setIsLoading(false);
    }
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

  const openMainWindow = useCallback(async () => {
    const api = window.recordingBarAPI;
    if (!api) return;

    try {
      await api.openMainWindow();
    } catch (error) {
      console.error('Failed to open main window:', error);
    }
  }, []);

  return {
    elapsedMs,
    isRecording,
    isLoading,
    mode,
    startRecording,
    stop,
    restart,
    cancel,
    openMainWindow,
  };
}
