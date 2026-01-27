import { contextBridge, ipcRenderer } from 'electron';

interface RecordingBarState {
  isRecording: boolean;
  elapsedMs: number;
}

const recordingBarAPI = {
  stopRecording: (): Promise<void> =>
    ipcRenderer.invoke('recording-bar-stop'),

  restartRecording: (): Promise<void> =>
    ipcRenderer.invoke('recording-bar-restart'),

  cancelRecording: (): Promise<void> =>
    ipcRenderer.invoke('recording-bar-cancel'),

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
