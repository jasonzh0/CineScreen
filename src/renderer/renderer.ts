import type { RecordingConfig, CursorConfig, ZoomConfig } from '../types';
import { DEFAULT_FRAME_RATE, DEFAULT_CURSOR_SIZE } from '../utils/constants';

// Type definition for electronAPI in renderer context
type RendererElectronAPI = {
  checkPermissions: () => Promise<{
    screenRecording: boolean;
    accessibility: boolean;
  }>;
  requestPermissions: () => Promise<void>;
  startRecording: (config: RecordingConfig) => Promise<{ success: boolean }>;
  stopRecording: (config: {
    cursorConfig: CursorConfig;
    zoomConfig?: ZoomConfig;
  }) => Promise<{ success: boolean; outputPath: string; metadataPath?: string }>;
  getRecordingState: () => Promise<{
    isRecording: boolean;
    startTime?: number;
    outputPath?: string;
  }>;
  selectOutputPath: () => Promise<string | null>;
  onDebugLog: (callback: (message: string) => void) => void;
  removeDebugLogListener: () => void;
  onProcessingProgress: (callback: (data: { percent: number; message: string }) => void) => void;
  removeProcessingProgressListener: () => void;
  openStudio: (videoPath: string, metadataPath: string) => Promise<{ success: boolean }>;
  selectVideoFile: () => Promise<string | null>;
  selectMetadataFile: () => Promise<string | null>;
};

// DOM Elements
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const openStudioBtn = document.getElementById('open-studio-btn') as HTMLButtonElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const recordingStatus = document.getElementById('recording-status') as HTMLDivElement;
const screenRecordingStatus = document.getElementById('screen-recording-status') as HTMLSpanElement;
const accessibilityStatus = document.getElementById('accessibility-status') as HTMLSpanElement;
const microphoneStatus = document.getElementById('microphone-status') as HTMLSpanElement;
const requestPermissionsBtn = document.getElementById('request-permissions-btn') as HTMLButtonElement;
const outputPathInput = document.getElementById('output-path') as HTMLInputElement;
const selectPathBtn = document.getElementById('select-path-btn') as HTMLButtonElement;
const toggleDebugBtn = document.getElementById('toggle-debug-btn') as HTMLButtonElement;
const clearDebugBtn = document.getElementById('clear-debug-btn') as HTMLButtonElement;
const debugLogContainer = document.getElementById('debug-log-container') as HTMLDivElement;
const debugLogContent = document.getElementById('debug-log-content') as HTMLDivElement;
const autoscrollCheckbox = document.getElementById('autoscroll-checkbox') as HTMLInputElement;

// Progress bar elements
const processingProgress = document.getElementById('processing-progress') as HTMLDivElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressText = document.getElementById('progress-text') as HTMLSpanElement;

let isRecording = false;
let isProcessing = false;
let outputPath: string | null = null;
let debugLogsVisible = false;
const maxLogEntries = 500; // Limit log entries to prevent memory issues

// Initialize
async function init() {
  await checkPermissions();
  updateUI();
  setupEventListeners();
  setupOpenStudioButton();

  // Set default output path
  const api = window.electronAPI as RendererElectronAPI | undefined;
  if (api) {
    outputPath = await api.selectOutputPath();
    if (outputPath) {
      outputPathInput.value = outputPath;
    }
  }
}

// Setup event listeners
function setupEventListeners() {
  // No settings event listeners needed - settings moved to studio
}

// Permission polling
let permissionPollInterval: ReturnType<typeof setInterval> | null = null;

// Check permissions
async function checkPermissions() {
  try {
    const api = window.electronAPI as RendererElectronAPI | undefined;
    if (!api) {
      console.error('electronAPI not available');
      return;
    }
    const permissions = await api.checkPermissions();
    updatePermissionStatus(permissions);

    // Start or stop polling based on permission status
    const allGranted = permissions.screenRecording && permissions.accessibility && permissions.microphone;
    if (allGranted) {
      stopPermissionPolling();
    } else {
      startPermissionPolling();
    }
  } catch (error) {
    console.error('Error checking permissions:', error);
  }
}

// Start polling for permission changes
function startPermissionPolling() {
  if (permissionPollInterval) return; // Already polling
  permissionPollInterval = setInterval(() => {
    checkPermissions();
  }, 1500); // Check every 1.5 seconds
}

// Stop polling
function stopPermissionPolling() {
  if (permissionPollInterval) {
    clearInterval(permissionPollInterval);
    permissionPollInterval = null;
  }
}

// Update permission status UI
function updatePermissionStatus(permissions: {
  screenRecording: boolean;
  accessibility: boolean;
  microphone: boolean;
}) {
  screenRecordingStatus.textContent = permissions.screenRecording
    ? 'Granted'
    : 'Not Granted';
  screenRecordingStatus.className = `status ${permissions.screenRecording ? 'granted' : 'denied'}`;

  accessibilityStatus.textContent = permissions.accessibility
    ? 'Granted'
    : 'Not Granted';
  accessibilityStatus.className = `status ${permissions.accessibility ? 'granted' : 'denied'}`;

  microphoneStatus.textContent = permissions.microphone
    ? 'Granted'
    : 'Not Granted';
  microphoneStatus.className = `status ${permissions.microphone ? 'granted' : 'denied'}`;

  const allGranted = permissions.screenRecording && permissions.accessibility && permissions.microphone;
  requestPermissionsBtn.style.display = allGranted ? 'none' : 'block';
  recordBtn.disabled = !allGranted || isRecording;

  // Show/hide the permissions note
  const permissionsNote = document.getElementById('permissions-note');
  if (permissionsNote) {
    permissionsNote.style.display = allGranted ? 'none' : 'block';
  }
}

// Request permissions
requestPermissionsBtn.addEventListener('click', async () => {
  try {
    const api = window.electronAPI as RendererElectronAPI | undefined;
    if (!api) {
      console.error('electronAPI not available');
      return;
    }
    await api.requestPermissions();
    // Start polling to detect when user grants permissions
    startPermissionPolling();
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
    const api = window.electronAPI as RendererElectronAPI | undefined;
    if (!api) {
      alert('electronAPI not available');
      return;
    }
    outputPath = await api.selectOutputPath();
    if (!outputPath) {
      alert('Please select an output path');
      return;
    }
    outputPathInput.value = outputPath;
  }

  const config: RecordingConfig = {
    outputPath: outputPath!,
    frameRate: DEFAULT_FRAME_RATE,
    quality: 'medium',
  };

  try {
    const api = window.electronAPI as RendererElectronAPI | undefined;
    if (!api) {
      alert('electronAPI not available');
      return;
    }
    statusText.textContent = 'Starting recording...';
    recordBtn.disabled = true;

    await api.startRecording(config);

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

  // Use default configs - settings are now in studio
  const cursorConfig: CursorConfig = {
    size: DEFAULT_CURSOR_SIZE,
    shape: 'arrow',
  };

  const zoomConfig: ZoomConfig | undefined = {
    enabled: true,
    level: 2.0,
    transitionSpeed: 300,
    padding: 0,
    followSpeed: 1.0,
  };

  try {
    statusText.textContent = 'Stopping recording...';
    stopBtn.disabled = true;
    isProcessing = true;

    // Show progress bar
    processingProgress.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Processing video...';

    const api = window.electronAPI as RendererElectronAPI | undefined;
    if (!api) {
      alert('electronAPI not available');
      stopBtn.disabled = false;
      isProcessing = false;
      processingProgress.style.display = 'none';
      return;
    }

    const result = await api.stopRecording({
      cursorConfig,
      zoomConfig,
    });

    isRecording = false;
    isProcessing = false;
    updateUI();

    // Hide progress bar
    processingProgress.style.display = 'none';

    statusText.textContent = `Recording saved to: ${result.outputPath}`;
    recordingStatus.classList.remove('recording');

    // Show "Open in Studio" button if metadata was exported
    if (result.metadataPath) {
      showOpenStudioButton(result.outputPath, result.metadataPath);
    }

    // Reset output path for next recording
    outputPath = null;
    outputPathInput.value = '';
  } catch (error) {
    console.error('Error stopping recording:', error);
    alert(`Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    stopBtn.disabled = false;
    isProcessing = false;
    processingProgress.style.display = 'none';
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

// Settings removed - now in studio

// Select output path
selectPathBtn.addEventListener('click', async () => {
  const api = window.electronAPI as RendererElectronAPI | undefined;
  if (!api) {
    alert('electronAPI not available');
    return;
  }
  const path = await api.selectOutputPath();
  if (path) {
    outputPath = path;
    outputPathInput.value = path;
  }
});

function addDebugLog(message: string) {
  const entry = document.createElement('div');
  entry.className = 'debug-log-entry';

  // Determine log level based on message content
  if (message.toLowerCase().includes('error')) {
    entry.classList.add('error');
  } else if (message.toLowerCase().includes('warning') || message.toLowerCase().includes('warn')) {
    entry.classList.add('warning');
  } else {
    entry.classList.add('info');
  }

  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;

  debugLogContent.appendChild(entry);

  // Limit number of log entries
  const entries = debugLogContent.children;
  if (entries.length > maxLogEntries) {
    debugLogContent.removeChild(entries[0]);
  }

  // Auto-scroll to bottom if enabled
  if (debugLogsVisible && autoscrollCheckbox.checked) {
    debugLogContainer.scrollTop = debugLogContainer.scrollHeight;
  }
}

toggleDebugBtn.addEventListener('click', () => {
  debugLogsVisible = !debugLogsVisible;
  debugLogContainer.style.display = debugLogsVisible ? 'block' : 'none';
  toggleDebugBtn.textContent = debugLogsVisible ? 'Hide Logs' : 'Show Logs';

  // Scroll to bottom when showing (if autoscroll enabled)
  if (debugLogsVisible && autoscrollCheckbox.checked) {
    setTimeout(() => {
      debugLogContainer.scrollTop = debugLogContainer.scrollHeight;
    }, 100);
  }
});

clearDebugBtn.addEventListener('click', () => {
  debugLogContent.innerHTML = '';
  addDebugLog('Debug logs cleared');
});

const api = window.electronAPI as RendererElectronAPI | undefined;
if (api) {
  api.onDebugLog((message: string) => {
    addDebugLog(message);
  });

  // Set up processing progress listener
  api.onProcessingProgress((data: { percent: number; message: string }) => {
    if (isProcessing) {
      progressFill.style.width = `${data.percent}%`;
      progressText.textContent = `${data.message} (${data.percent}%)`;
    }
  });
}

function showOpenStudioButton(videoPath: string, metadataPath: string) {
  // Show a temporary "Open in Studio" button after recording
  const tempBtn = document.createElement('button');
  tempBtn.className = 'btn btn-primary';
  tempBtn.textContent = 'Open in Studio';
  tempBtn.style.marginTop = '10px';
  tempBtn.style.width = '100%';

  tempBtn.addEventListener('click', async () => {
    try {
      const api = window.electronAPI as RendererElectronAPI | undefined;
      if (!api) {
        alert('electronAPI not available');
        return;
      }
      await api.openStudio(videoPath, metadataPath);
      tempBtn.remove();
    } catch (error) {
      console.error('Failed to open studio:', error);
      alert(`Failed to open studio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Insert after status text
  const recordingSection = document.querySelector('.recording-section');
  if (recordingSection) {
    recordingSection.appendChild(tempBtn);
  }
}

// Set up permanent Open Studio button
function setupOpenStudioButton() {
  if (!openStudioBtn) {
    console.error('Open Studio button not found');
    return;
  }

  openStudioBtn.addEventListener('click', async () => {
    try {
      const api = window.electronAPI as RendererElectronAPI | undefined;
      if (!api) {
        alert('electronAPI not available');
        return;
      }
      // Show file dialogs to select video and metadata
      const videoPath = await api.selectVideoFile();
      if (!videoPath) {
        return; // User cancelled
      }

      const metadataPath = await api.selectMetadataFile();
      if (!metadataPath) {
        return; // User cancelled
      }

      // Open studio with selected files
      await api.openStudio(videoPath, metadataPath);
    } catch (error) {
      console.error('Failed to open studio:', error);
      alert(`Failed to open studio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}

// Initialize on load
init();

// Poll recording state (in case it changes externally)
setInterval(async () => {
  try {
    const api = window.electronAPI as RendererElectronAPI | undefined;
    if (!api) {
      return;
    }
    const state = await api.getRecordingState();
    if (state.isRecording !== isRecording) {
      isRecording = state.isRecording;
      updateUI();
    }
  } catch (error) {
    // Ignore errors
  }
}, 1000);

