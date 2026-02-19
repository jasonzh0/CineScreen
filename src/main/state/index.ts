/**
 * State management barrel export
 */
export {
  getRecordingState,
  getCurrentRecordingConfig,
  getConfiguredOutputDir,
  getConfiguredOutputPath,
  getScreenCapture,
  getMouseTracker,
  setRecordingState,
  setCurrentRecordingConfig,
  setConfiguredOutputDir,
  createScreenCapture,
  createMouseTracker,
  cleanupRecording,
} from './recording-state';

export {
  loadConfig,
  saveConfig,
  getConfigValue,
  setConfigValue,
} from './config-store';
export type { UserConfig } from './config-store';
