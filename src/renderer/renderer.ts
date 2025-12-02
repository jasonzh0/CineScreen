import type { RecordingConfig, CursorConfig } from '../types';

declare global {
  interface Window {
    electronAPI: {
      checkPermissions: () => Promise<{
        screenRecording: boolean;
        accessibility: boolean;
      }>;
      requestPermissions: () => Promise<void>;
      startRecording: (config: RecordingConfig) => Promise<{ success: boolean }>;
      stopRecording: (
        cursorConfig: CursorConfig
      ) => Promise<{ success: boolean; outputPath: string }>;
      getRecordingState: () => Promise<{
        isRecording: boolean;
        startTime?: number;
        outputPath?: string;
      }>;
      selectOutputPath: () => Promise<string | null>;
    };
  }
}

// DOM Elements
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const recordingStatus = document.getElementById('recording-status') as HTMLDivElement;
const screenRecordingStatus = document.getElementById('screen-recording-status') as HTMLSpanElement;
const accessibilityStatus = document.getElementById('accessibility-status') as HTMLSpanElement;
const requestPermissionsBtn = document.getElementById('request-permissions-btn') as HTMLButtonElement;
const cursorSizeSlider = document.getElementById('cursor-size') as HTMLInputElement;
const cursorSizeValue = document.getElementById('cursor-size-value') as HTMLSpanElement;
const cursorShapeSelect = document.getElementById('cursor-shape') as HTMLSelectElement;
const smoothingSlider = document.getElementById('smoothing') as HTMLInputElement;
const smoothingValue = document.getElementById('smoothing-value') as HTMLSpanElement;
const outputPathInput = document.getElementById('output-path') as HTMLInputElement;
const selectPathBtn = document.getElementById('select-path-btn') as HTMLButtonElement;

let isRecording = false;
let outputPath: string | null = null;

// Initialize
async function init() {
  await checkPermissions();
  updateUI();

  // Set default output path
  outputPath = await window.electronAPI.selectOutputPath();
  if (outputPath) {
    outputPathInput.value = outputPath;
  }
}

// Check permissions
async function checkPermissions() {
  try {
    const permissions = await window.electronAPI.checkPermissions();
    updatePermissionStatus(permissions);
  } catch (error) {
    console.error('Error checking permissions:', error);
  }
}

// Update permission status UI
function updatePermissionStatus(permissions: {
  screenRecording: boolean;
  accessibility: boolean;
}) {
  screenRecordingStatus.textContent = permissions.screenRecording
    ? 'Granted'
    : 'Denied';
  screenRecordingStatus.className = `status ${
    permissions.screenRecording ? 'granted' : 'denied'
  }`;

  accessibilityStatus.textContent = permissions.accessibility
    ? 'Granted'
    : 'Denied';
  accessibilityStatus.className = `status ${
    permissions.accessibility ? 'granted' : 'denied'
  }`;

  const allGranted = permissions.screenRecording && permissions.accessibility;
  requestPermissionsBtn.style.display = allGranted ? 'none' : 'block';
  recordBtn.disabled = !allGranted || isRecording;
}

// Request permissions
requestPermissionsBtn.addEventListener('click', async () => {
  try {
    await window.electronAPI.requestPermissions();
    // Wait a bit for user to grant permissions
    setTimeout(() => {
      checkPermissions();
    }, 1000);
  } catch (error) {
    console.error('Error requesting permissions:', error);
  }
});

// Start recording
recordBtn.addEventListener('click', async () => {
  if (isRecording) {
    return;
  }

  if (!outputPath) {
    outputPath = await window.electronAPI.selectOutputPath();
    if (!outputPath) {
      alert('Please select an output path');
      return;
    }
    outputPathInput.value = outputPath;
  }

  const config: RecordingConfig = {
    outputPath: outputPath!,
    frameRate: 30,
    quality: 'medium',
  };

  try {
    statusText.textContent = 'Starting recording...';
    recordBtn.disabled = true;

    await window.electronAPI.startRecording(config);

    isRecording = true;
    updateUI();
    statusText.textContent = 'Recording...';
    recordingStatus.classList.add('recording');
  } catch (error) {
    console.error('Error starting recording:', error);
    alert(`Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    recordBtn.disabled = false;
    statusText.textContent = 'Failed to start recording';
  }
});

// Stop recording
stopBtn.addEventListener('click', async () => {
  if (!isRecording) {
    return;
  }

  const cursorConfig: CursorConfig = {
    size: parseInt(cursorSizeSlider.value),
    shape: cursorShapeSelect.value as CursorConfig['shape'],
    smoothing: parseInt(smoothingSlider.value) / 100,
  };

  try {
    statusText.textContent = 'Stopping recording...';
    stopBtn.disabled = true;

    const result = await window.electronAPI.stopRecording(cursorConfig);

    isRecording = false;
    updateUI();
    statusText.textContent = `Recording saved to: ${result.outputPath}`;
    recordingStatus.classList.remove('recording');

    // Reset output path for next recording
    outputPath = null;
    outputPathInput.value = '';
  } catch (error) {
    console.error('Error stopping recording:', error);
    alert(`Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    stopBtn.disabled = false;
    statusText.textContent = 'Failed to stop recording';
  }
});

// Update UI based on recording state
function updateUI() {
  recordBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;

  if (!isRecording) {
    const permissions = {
      screenRecording: screenRecordingStatus.classList.contains('granted'),
      accessibility: accessibilityStatus.classList.contains('granted'),
    };
    recordBtn.disabled = !(permissions.screenRecording && permissions.accessibility);
  }
}

// Cursor size slider
cursorSizeSlider.addEventListener('input', (e) => {
  const value = (e.target as HTMLInputElement).value;
  cursorSizeValue.textContent = value;
});

// Smoothing slider
smoothingSlider.addEventListener('input', (e) => {
  const value = (e.target as HTMLInputElement).value;
  smoothingValue.textContent = value;
});

// Select output path
selectPathBtn.addEventListener('click', async () => {
  const path = await window.electronAPI.selectOutputPath();
  if (path) {
    outputPath = path;
    outputPathInput.value = path;
  }
});

// Initialize on load
init();

// Poll recording state (in case it changes externally)
setInterval(async () => {
  try {
    const state = await window.electronAPI.getRecordingState();
    if (state.isRecording !== isRecording) {
      isRecording = state.isRecording;
      updateUI();
    }
  } catch (error) {
    // Ignore errors
  }
}, 1000);

