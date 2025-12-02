import type { RecordingConfig, CursorConfig, ZoomConfig, MouseEffectsConfig } from '../types';

declare global {
  interface Window {
    electronAPI: {
      checkPermissions: () => Promise<{
        screenRecording: boolean;
        accessibility: boolean;
      }>;
      requestPermissions: () => Promise<void>;
      startRecording: (config: RecordingConfig) => Promise<{ success: boolean }>;
      stopRecording: (config: {
        cursorConfig: CursorConfig;
        zoomConfig?: ZoomConfig;
        mouseEffectsConfig?: MouseEffectsConfig;
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
  }
}

// DOM Elements
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const openStudioBtn = document.getElementById('open-studio-btn') as HTMLButtonElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const recordingStatus = document.getElementById('recording-status') as HTMLDivElement;
const screenRecordingStatus = document.getElementById('screen-recording-status') as HTMLSpanElement;
const accessibilityStatus = document.getElementById('accessibility-status') as HTMLSpanElement;
const requestPermissionsBtn = document.getElementById('request-permissions-btn') as HTMLButtonElement;
const cursorSizeSlider = document.getElementById('cursor-size') as HTMLInputElement;
const cursorSizeValue = document.getElementById('cursor-size-value') as HTMLSpanElement;
const cursorShapeSelect = document.getElementById('cursor-shape') as HTMLSelectElement;
const cursorColorInput = document.getElementById('cursor-color') as HTMLInputElement;
const smoothingSlider = document.getElementById('smoothing') as HTMLInputElement;
const smoothingValue = document.getElementById('smoothing-value') as HTMLSpanElement;
const outputPathInput = document.getElementById('output-path') as HTMLInputElement;
const selectPathBtn = document.getElementById('select-path-btn') as HTMLButtonElement;
const toggleDebugBtn = document.getElementById('toggle-debug-btn') as HTMLButtonElement;
const clearDebugBtn = document.getElementById('clear-debug-btn') as HTMLButtonElement;
const debugLogContainer = document.getElementById('debug-log-container') as HTMLDivElement;
const debugLogContent = document.getElementById('debug-log-content') as HTMLDivElement;

// Zoom settings
const zoomEnabledCheckbox = document.getElementById('zoom-enabled') as HTMLInputElement;
const zoomLevelSlider = document.getElementById('zoom-level') as HTMLInputElement;
const zoomLevelValue = document.getElementById('zoom-level-value') as HTMLSpanElement;
const zoomTransitionSlider = document.getElementById('zoom-transition-speed') as HTMLInputElement;
const zoomTransitionValue = document.getElementById('zoom-transition-speed-value') as HTMLSpanElement;
const zoomPaddingSlider = document.getElementById('zoom-padding') as HTMLInputElement;
const zoomPaddingValue = document.getElementById('zoom-padding-value') as HTMLSpanElement;
const zoomFollowSlider = document.getElementById('zoom-follow-speed') as HTMLInputElement;
const zoomFollowValue = document.getElementById('zoom-follow-speed-value') as HTMLSpanElement;

// Mouse effects settings
const clickCirclesEnabled = document.getElementById('click-circles-enabled') as HTMLInputElement;
const clickCirclesSizeSlider = document.getElementById('click-circles-size') as HTMLInputElement;
const clickCirclesSizeValue = document.getElementById('click-circles-size-value') as HTMLSpanElement;
const clickCirclesColorPicker = document.getElementById('click-circles-color-picker') as HTMLInputElement;
const clickCirclesDurationSlider = document.getElementById('click-circles-duration') as HTMLInputElement;
const clickCirclesDurationValue = document.getElementById('click-circles-duration-value') as HTMLSpanElement;

const trailEnabled = document.getElementById('trail-enabled') as HTMLInputElement;
const trailLengthSlider = document.getElementById('trail-length') as HTMLInputElement;
const trailLengthValue = document.getElementById('trail-length-value') as HTMLSpanElement;
const trailFadeSlider = document.getElementById('trail-fade-speed') as HTMLInputElement;
const trailFadeValue = document.getElementById('trail-fade-speed-value') as HTMLSpanElement;
const trailColorPicker = document.getElementById('trail-color-picker') as HTMLInputElement;

const highlightRingEnabled = document.getElementById('highlight-ring-enabled') as HTMLInputElement;
const highlightRingSizeSlider = document.getElementById('highlight-ring-size') as HTMLInputElement;
const highlightRingSizeValue = document.getElementById('highlight-ring-size-value') as HTMLSpanElement;
const highlightRingColorPicker = document.getElementById('highlight-ring-color-picker') as HTMLInputElement;
const highlightRingPulseSlider = document.getElementById('highlight-ring-pulse-speed') as HTMLInputElement;
const highlightRingPulseValue = document.getElementById('highlight-ring-pulse-speed-value') as HTMLSpanElement;

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
  outputPath = await window.electronAPI.selectOutputPath();
  if (outputPath) {
    outputPathInput.value = outputPath;
  }
}

// Setup event listeners for all settings
function setupEventListeners() {
  // Zoom enabled toggle
  zoomEnabledCheckbox.addEventListener('change', () => {
    const enabled = zoomEnabledCheckbox.checked;
    const zoomSettings = document.getElementById('zoom-settings');
    const zoomTransition = document.getElementById('zoom-transition');
    const zoomPadding = document.getElementById('zoom-padding');
    const zoomFollow = document.getElementById('zoom-follow');
    
    [zoomSettings, zoomTransition, zoomPadding, zoomFollow].forEach(el => {
      if (el) el.style.display = enabled ? 'block' : 'none';
    });
  });

  // Click circles enabled toggle
  clickCirclesEnabled.addEventListener('change', () => {
    const enabled = clickCirclesEnabled.checked;
    const settings = document.getElementById('click-circles-settings');
    const color = document.getElementById('click-circles-color');
    const duration = document.getElementById('click-circles-duration');
    
    [settings, color, duration].forEach(el => {
      if (el) el.style.display = enabled ? 'block' : 'none';
    });
  });

  // Trail enabled toggle
  trailEnabled.addEventListener('change', () => {
    const enabled = trailEnabled.checked;
    const settings = document.getElementById('trail-settings');
    const fade = document.getElementById('trail-fade');
    const color = document.getElementById('trail-color');
    
    [settings, fade, color].forEach(el => {
      if (el) el.style.display = enabled ? 'block' : 'none';
    });
  });

  // Highlight ring enabled toggle
  highlightRingEnabled.addEventListener('change', () => {
    const enabled = highlightRingEnabled.checked;
    const settings = document.getElementById('highlight-ring-settings');
    const color = document.getElementById('highlight-ring-color');
    const pulse = document.getElementById('highlight-ring-pulse');
    
    [settings, color, pulse].forEach(el => {
      if (el) el.style.display = enabled ? 'block' : 'none';
    });
  });

  // Zoom sliders
  zoomLevelSlider.addEventListener('input', (e) => {
    zoomLevelValue.textContent = (e.target as HTMLInputElement).value;
  });
  zoomTransitionSlider.addEventListener('input', (e) => {
    zoomTransitionValue.textContent = (e.target as HTMLInputElement).value;
  });
  zoomPaddingSlider.addEventListener('input', (e) => {
    zoomPaddingValue.textContent = (e.target as HTMLInputElement).value;
  });
  zoomFollowSlider.addEventListener('input', (e) => {
    zoomFollowValue.textContent = (e.target as HTMLInputElement).value;
  });

  // Click circles sliders
  clickCirclesSizeSlider.addEventListener('input', (e) => {
    clickCirclesSizeValue.textContent = (e.target as HTMLInputElement).value;
  });
  clickCirclesDurationSlider.addEventListener('input', (e) => {
    clickCirclesDurationValue.textContent = (e.target as HTMLInputElement).value;
  });

  // Trail sliders
  trailLengthSlider.addEventListener('input', (e) => {
    trailLengthValue.textContent = (e.target as HTMLInputElement).value;
  });
  trailFadeSlider.addEventListener('input', (e) => {
    trailFadeValue.textContent = (e.target as HTMLInputElement).value;
  });

  // Highlight ring sliders
  highlightRingSizeSlider.addEventListener('input', (e) => {
    highlightRingSizeValue.textContent = (e.target as HTMLInputElement).value;
  });
  highlightRingPulseSlider.addEventListener('input', (e) => {
    highlightRingPulseValue.textContent = (e.target as HTMLInputElement).value;
  });

  // Initialize visibility
  zoomEnabledCheckbox.dispatchEvent(new Event('change'));
  clickCirclesEnabled.dispatchEvent(new Event('change'));
  trailEnabled.dispatchEvent(new Event('change'));
  highlightRingEnabled.dispatchEvent(new Event('change'));
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
    color: cursorColorInput.value,
  };

  const zoomConfig: ZoomConfig | undefined = zoomEnabledCheckbox.checked ? {
    enabled: true,
    level: parseFloat(zoomLevelSlider.value),
    transitionSpeed: parseInt(zoomTransitionSlider.value),
    padding: parseInt(zoomPaddingSlider.value),
    followSpeed: parseInt(zoomFollowSlider.value) / 100,
    smoothness: 'cinematic',
  } : undefined;

  const mouseEffectsConfig: MouseEffectsConfig | undefined = {
    clickCircles: {
      enabled: clickCirclesEnabled.checked,
      size: parseInt(clickCirclesSizeSlider.value),
      color: clickCirclesColorPicker.value,
      duration: parseInt(clickCirclesDurationSlider.value),
    },
    trail: {
      enabled: trailEnabled.checked,
      length: parseInt(trailLengthSlider.value),
      fadeSpeed: parseInt(trailFadeSlider.value) / 100,
      color: trailColorPicker.value,
    },
    highlightRing: {
      enabled: highlightRingEnabled.checked,
      size: parseInt(highlightRingSizeSlider.value),
      color: highlightRingColorPicker.value,
      pulseSpeed: parseInt(highlightRingPulseSlider.value) / 100,
    },
  };

  try {
    statusText.textContent = 'Stopping recording...';
    stopBtn.disabled = true;
    isProcessing = true;
    
    // Show progress bar
    processingProgress.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Processing video...';

    const result = await window.electronAPI.stopRecording({
      cursorConfig,
      zoomConfig,
      mouseEffectsConfig,
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

// Debug log functionality
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
  
  // Auto-scroll to bottom
  if (debugLogsVisible) {
    debugLogContainer.scrollTop = debugLogContainer.scrollHeight;
  }
}

// Toggle debug log visibility
toggleDebugBtn.addEventListener('click', () => {
  debugLogsVisible = !debugLogsVisible;
  debugLogContainer.style.display = debugLogsVisible ? 'block' : 'none';
  toggleDebugBtn.textContent = debugLogsVisible ? 'Hide Logs' : 'Show Logs';
  
  // Scroll to bottom when showing
  if (debugLogsVisible) {
    setTimeout(() => {
      debugLogContainer.scrollTop = debugLogContainer.scrollHeight;
    }, 100);
  }
});

// Clear debug logs
clearDebugBtn.addEventListener('click', () => {
  debugLogContent.innerHTML = '';
  addDebugLog('Debug logs cleared');
});

// Set up debug log listener
window.electronAPI.onDebugLog((message: string) => {
  addDebugLog(message);
});

// Set up processing progress listener
window.electronAPI.onProcessingProgress((data: { percent: number; message: string }) => {
  if (isProcessing) {
    progressFill.style.width = `${data.percent}%`;
    progressText.textContent = `${data.message} (${data.percent}%)`;
  }
});

function showOpenStudioButton(videoPath: string, metadataPath: string) {
  // Show a temporary "Open in Studio" button after recording
  const tempBtn = document.createElement('button');
  tempBtn.className = 'btn btn-primary';
  tempBtn.textContent = 'Open in Studio';
  tempBtn.style.marginTop = '10px';
  tempBtn.style.width = '100%';

  tempBtn.addEventListener('click', async () => {
    try {
      await window.electronAPI.openStudio(videoPath, metadataPath);
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
      // Show file dialogs to select video and metadata
      const videoPath = await window.electronAPI.selectVideoFile();
      if (!videoPath) {
        return; // User cancelled
      }

      const metadataPath = await window.electronAPI.selectMetadataFile();
      if (!metadataPath) {
        return; // User cancelled
      }

      // Open studio with selected files
      await window.electronAPI.openStudio(videoPath, metadataPath);
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
    const state = await window.electronAPI.getRecordingState();
    if (state.isRecording !== isRecording) {
      isRecording = state.isRecording;
      updateUI();
    }
  } catch (error) {
    // Ignore errors
  }
}, 1000);

