import { useState, useEffect, useCallback, useRef } from 'react';

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

  // Freeze UI state while loading — queue the last update and apply when done
  const loadingRef = useRef(false);
  const pendingStateRef = useRef<RecordingBarState | null>(null);

  const applyState = useCallback((state: RecordingBarState) => {
    setElapsedMs(state.elapsedMs);
    setIsRecording(state.isRecording);
    setMode(state.mode || (state.isRecording ? 'recording' : 'idle'));
  }, []);

  useEffect(() => {
    const api = window.recordingBarAPI;
    if (!api) {
      console.error('recordingBarAPI not available');
      return;
    }

    api.onRecordingStateUpdate((state: RecordingBarState) => {
      if (loadingRef.current) {
        pendingStateRef.current = state;
        return;
      }
      applyState(state);
    });

    api.onRecordingTimerUpdate((elapsed: number) => {
      if (loadingRef.current) return;
      setElapsedMs(elapsed);
    });
  }, [applyState]);

  const withLoading = useCallback(
    (fn: () => Promise<void>) => async () => {
      const api = window.recordingBarAPI;
      if (!api) return;

      loadingRef.current = true;
      pendingStateRef.current = null;
      setIsLoading(true);
      try {
        await fn();
      } catch (error) {
        console.error('Recording action failed:', error);
      } finally {
        loadingRef.current = false;
        setIsLoading(false);
        if (pendingStateRef.current) {
          applyState(pendingStateRef.current);
          pendingStateRef.current = null;
        }
      }
    },
    [applyState]
  );

  const startRecording = useCallback(
    withLoading(async () => {
      await window.recordingBarAPI!.startRecording();
    }),
    [withLoading]
  );

  const stop = useCallback(
    withLoading(async () => {
      await window.recordingBarAPI!.stopRecording();
    }),
    [withLoading]
  );

  const restart = useCallback(
    withLoading(async () => {
      await window.recordingBarAPI!.restartRecording();
    }),
    [withLoading]
  );

  const cancel = useCallback(
    withLoading(async () => {
      await window.recordingBarAPI!.cancelRecording();
    }),
    [withLoading]
  );

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
