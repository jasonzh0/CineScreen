import { contextBridge, ipcRenderer } from 'electron';
import type { RecordingConfig, CursorConfig, PermissionStatus, RecordingState } from '../types';

contextBridge.exposeInMainWorld('electronAPI', {
  checkPermissions: (): Promise<PermissionStatus> =>
    ipcRenderer.invoke('check-permissions'),

  requestPermissions: (): Promise<void> =>
    ipcRenderer.invoke('request-permissions'),

  startRecording: (config: RecordingConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('start-recording', config),

  stopRecording: (
    cursorConfig: CursorConfig
  ): Promise<{ success: boolean; outputPath: string }> =>
    ipcRenderer.invoke('stop-recording', cursorConfig),

  getRecordingState: (): Promise<RecordingState> =>
    ipcRenderer.invoke('get-recording-state'),

  selectOutputPath: (): Promise<string | null> =>
    ipcRenderer.invoke('select-output-path'),
});

