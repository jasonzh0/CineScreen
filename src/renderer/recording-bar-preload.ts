import { contextBridge, ipcRenderer } from 'electron';

type RecordingBarMode = 'idle' | 'recording';

interface RecordingBarState {
  isRecording: boolean;
  elapsedMs: number;
  mode: RecordingBarMode;
}

const recordingBarAPI = {
  stopRecording: (): Promise<void> =>
    ipcRenderer.invoke('recording-bar-stop'),

  restartRecording: (): Promise<void> =>
    ipcRenderer.invoke('recording-bar-restart'),

  cancelRecording: (): Promise<void> =>
    ipcRenderer.invoke('recording-bar-cancel'),

  startRecording: (): Promise<void> =>
    ipcRenderer.invoke('recording-bar-start'),

  openMainWindow: (): Promise<void> =>
    ipcRenderer.invoke('open-main-window'),

  onRecordingStateUpdate: (callback: (state: RecordingBarState) => void) => {
    ipcRenderer.on('recording-state-update', (_event, state: RecordingBarState) => {
      callback(state);
    });
  },

  onRecordingTimerUpdate: (callback: (elapsedMs: number) => void) => {
    ipcRenderer.on('recording-timer-update', (_event, elapsedMs: number) => {
      callback(elapsedMs);
    });
  },
};

contextBridge.exposeInMainWorld('recordingBarAPI', recordingBarAPI);
