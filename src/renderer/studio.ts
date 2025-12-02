import type { RecordingMetadata, CursorKeyframe, ZoomKeyframe } from '../types/metadata';
import { Timeline } from './components/timeline';
import { VideoPreview } from './components/video-preview';
import { CursorEditor } from './components/cursor-editor';
import { ZoomEditor } from './components/zoom-editor';
import { KeyframePanel } from './components/keyframe-panel';
import { renderCursor } from './utils/cursor-renderer';
import { renderZoom } from './utils/zoom-renderer';
import { createLogger } from '../utils/logger';

const logger = createLogger('Studio');

// Type assertion for electronAPI - methods are available in studio context
type StudioElectronAPI = {
  loadMetadata: (metadataPath: string) => Promise<RecordingMetadata>;
  getVideoInfo: (videoPath: string) => Promise<{
    width: number;
    height: number;
    frameRate: number;
    duration: number;
  }>;
  exportVideo: (videoPath: string, metadataPath: string, metadata: RecordingMetadata) => Promise<{ success: boolean; outputPath: string }>;
  onProcessingProgress: (callback: (data: { percent: number; message: string }) => void) => void;
  removeProcessingProgressListener: () => void;
};

// State
let metadata: RecordingMetadata | null = null;
let videoPath: string = '';
let metadataPath: string = '';
let timeline: Timeline | null = null;
let videoPreview: VideoPreview | null = null;
let cursorEditor: CursorEditor | null = null;
let zoomEditor: ZoomEditor | null = null;
let keyframePanel: KeyframePanel | null = null;
let isPlaying = false;
let currentTime = 0;

// Initialize
async function init() {
  logger.info('init() called');

  // Check electronAPI
  if (!window.electronAPI) {
    const error = 'electronAPI not available - preload script may not be loaded';
    logger.error(error);
    updateStatus(error);
    return;
  }

  logger.debug('electronAPI available, initializing components...');

  // Initialize components
  try {
    logger.debug('Creating Timeline...');
    timeline = new Timeline('timeline');
    logger.debug('Timeline created');

    logger.debug('Creating VideoPreview...');
    videoPreview = new VideoPreview(
      'video-element',
      'cursor-canvas',
      'zoom-canvas',
      'video-preview-wrapper'
    );
    logger.debug('VideoPreview created');

    // Initialize editors
    logger.debug('Creating editors...');
    const videoEl = videoPreview.getVideoElement();
    cursorEditor = new CursorEditor(videoEl);
    zoomEditor = new ZoomEditor(videoEl);
    logger.debug('Editors created');

    // Initialize keyframe panel
    logger.debug('Creating KeyframePanel...');
    keyframePanel = new KeyframePanel('cursor-keyframes-list', 'zoom-keyframes-list');
    logger.debug('KeyframePanel created');

    // Set up metadata update callbacks
    cursorEditor.setOnMetadataUpdate((updatedMetadata) => {
      metadata = updatedMetadata;
      if (timeline) {
        const duration = videoPreview?.getDuration() || 0;
        timeline.setMetadata(updatedMetadata, duration * 1000);
      }
      keyframePanel?.setMetadata(updatedMetadata);
    });

    zoomEditor.setOnMetadataUpdate((updatedMetadata) => {
      metadata = updatedMetadata;
      if (timeline) {
        const duration = videoPreview?.getDuration() || 0;
        timeline.setMetadata(updatedMetadata, duration * 1000);
      }
      keyframePanel?.setMetadata(updatedMetadata);
    });

    // Set up preview callbacks
    videoPreview.setOnTimeUpdate((time) => {
      currentTime = time;
      updateTimeDisplay();
      if (timeline) {
        timeline.updatePlayhead(time / 1000); // Convert to seconds
      }
      renderPreview();
    });

    videoPreview.setOnSeek((time) => {
      videoPreview?.seekTo(time);
    });

    timeline.setOnSeek((time) => {
      videoPreview?.seekTo(time);
    });

    // Set up keyframe panel callbacks
    keyframePanel.setOnSeek((time) => {
      videoPreview?.seekTo(time);
    });

    keyframePanel.setOnDeleteCursorKeyframe((timestamp) => {
      cursorEditor?.removeCursorKeyframe(timestamp);
    });

    keyframePanel.setOnDeleteZoomKeyframe((timestamp) => {
      zoomEditor?.removeZoomKeyframe(timestamp);
    });

    keyframePanel.setOnUpdateCursorSegment((segment) => {
      // Update the easing type on the start keyframe
      cursorEditor?.updateCursorKeyframe(segment.start.timestamp, {
        easing: segment.easing,
      });
    });

    keyframePanel.setOnUpdateZoomSegment((segment) => {
      // Update the easing type on the start keyframe
      zoomEditor?.updateZoomKeyframe(segment.start.timestamp, {
        easing: segment.easing,
      });
    });
  } catch (error) {
    logger.error('Failed to initialize components:', error);
    updateStatus(`Initialization error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return;
  }

  // Get video and metadata paths from URL parameters or injected data
  let videoPathParam: string | null = null;
  let metadataPathParam: string | null = null;

  // Try URL parameters first
  const urlParams = new URLSearchParams(window.location.search);
  videoPathParam = urlParams.get('videoPath');
  metadataPathParam = urlParams.get('metadataPath');

  // Fallback to injected data (for production mode)
  if ((!videoPathParam || !metadataPathParam) && (window as any).__studioInitData) {
    logger.info('Using injected studio init data');
    videoPathParam = (window as any).__studioInitData.videoPath;
    metadataPathParam = (window as any).__studioInitData.metadataPath;
  }

  if (videoPathParam && metadataPathParam) {
    videoPath = decodeURIComponent(videoPathParam);
    metadataPath = decodeURIComponent(metadataPathParam);
    logger.info('Loading studio data:', { videoPath, metadataPath });
    await loadStudioData();
  } else {
    logger.warn('Studio initialized without video/metadata paths');
    logger.debug('URL params:', { videoPathParam, metadataPathParam });
    logger.debug('Window location:', window.location.href);
    updateStatus('No video/metadata paths provided');
  }

  // Set up event listeners
  setupEventListeners();

  // Set up export progress listener
  setupExportProgressListener();
}

async function loadStudioData() {
  try {
    updateStatus('Loading metadata...');
    logger.info('Loading metadata from:', metadataPath);

    // Load metadata
    const api = window.electronAPI as any as StudioElectronAPI;
    if (!api || !api.loadMetadata) {
      throw new Error('electronAPI.loadMetadata not available');
    }

    metadata = await api.loadMetadata(metadataPath);
    logger.info('Metadata loaded successfully');
    logger.debug('Metadata:', metadata);

    // Load video
    const videoEl = videoPreview?.getVideoElement();
    if (!videoEl) {
      throw new Error('Video element not available');
    }

    // Use file:// protocol for local video files
    const videoSrc = videoPath.startsWith('file://') ? videoPath : `file://${videoPath}`;
    logger.info('Loading video from:', videoSrc);
    videoEl.src = videoSrc;

    // Wait for video metadata
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Video load timeout'));
      }, 10000);

      videoEl.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        resolve(undefined);
      }, { once: true });

      videoEl.addEventListener('error', (e) => {
        clearTimeout(timeout);
        reject(new Error(`Video load error: ${videoEl.error?.message || 'Unknown error'}`));
      }, { once: true });
    });

    logger.info('Video loaded, duration:', videoEl.duration, 'seconds');

    // Update timeline with metadata
    if (timeline && metadata) {
      const duration = videoEl.duration * 1000; // Convert to ms
      timeline.setMetadata(metadata, duration);
    }

    // Update editors and panel
    if (metadata) {
      cursorEditor?.setMetadata(metadata);
      zoomEditor?.setMetadata(metadata);
      keyframePanel?.setMetadata(metadata);
    }

    updateStatus('Ready');
    logger.info('Studio data loaded successfully');
  } catch (error) {
    logger.error('Failed to load studio data:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Error: ${errorMessage}`);
    alert(`Failed to load studio data: ${errorMessage}`);
  }
}

function setupEventListeners() {
  const playPauseBtn = document.getElementById('play-pause-btn');
  const exportBtn = document.getElementById('export-btn');

  playPauseBtn?.addEventListener('click', async () => {
    if (!videoPreview) return;

    if (isPlaying) {
      videoPreview.pause();
    } else {
      await videoPreview.play();
    }
  });

  // Update play/pause button state
  const videoEl = videoPreview?.getVideoElement();
  if (videoEl) {
    videoEl.addEventListener('play', () => {
      isPlaying = true;
      const btn = document.getElementById('play-pause-btn');
      if (btn) btn.textContent = 'Pause';
    });

    videoEl.addEventListener('pause', () => {
      isPlaying = false;
      const btn = document.getElementById('play-pause-btn');
      if (btn) btn.textContent = 'Play';
    });
  }

  exportBtn?.addEventListener('click', async () => {
    if (!metadata) {
      alert('No metadata loaded');
      return;
    }
    await exportVideo();
  });
}

function updateTimeDisplay() {
  const timeDisplay = document.getElementById('time-display');
  if (!timeDisplay || !videoPreview) return;

  const current = formatTime(currentTime / 1000);
  const total = formatTime(videoPreview.getDuration() || 0);
  timeDisplay.textContent = `${current} / ${total}`;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function renderPreview() {
  if (!metadata || !videoPreview) return;

  const videoEl = videoPreview.getVideoElement();
  const cursorCanvas = videoPreview.getCursorCanvas();
  const zoomCanvas = videoPreview.getZoomCanvas();

  // Get video element's bounding rect
  const videoRect = videoEl.getBoundingClientRect();
  const wrapper = document.getElementById('video-preview-wrapper');

  if (!wrapper) return;

  const wrapperRect = wrapper.getBoundingClientRect();
  
  // Calculate video position relative to wrapper
  const videoX = videoRect.left - wrapperRect.left;
  const videoY = videoRect.top - wrapperRect.top;

  // Update canvas positions and sizes to match video element
  cursorCanvas.width = videoRect.width;
  cursorCanvas.height = videoRect.height;
  cursorCanvas.style.width = `${videoRect.width}px`;
  cursorCanvas.style.height = `${videoRect.height}px`;
  cursorCanvas.style.left = `${videoX}px`;
  cursorCanvas.style.top = `${videoY}px`;
  cursorCanvas.style.position = 'absolute';

  zoomCanvas.width = videoRect.width;
  zoomCanvas.height = videoRect.height;
  zoomCanvas.style.width = `${videoRect.width}px`;
  zoomCanvas.style.height = `${videoRect.height}px`;
  zoomCanvas.style.left = `${videoX}px`;
  zoomCanvas.style.top = `${videoY}px`;
  zoomCanvas.style.position = 'absolute';

  const videoWidth = metadata.video.width;
  const videoHeight = metadata.video.height;

  // Use actual video display dimensions
  const displayWidth = videoRect.width;
  const displayHeight = videoRect.height;

  // Clamp currentTime to video duration to match render behavior and avoid edge cases
  const videoDuration = metadata.video.duration;
  const clampedTime = Math.min(currentTime, videoDuration);

  // Render cursor
  renderCursor(
    cursorCanvas,
    metadata,
    clampedTime,
    videoWidth,
    videoHeight,
    displayWidth,
    displayHeight
  );

  // Render zoom
  renderZoom(
    zoomCanvas,
    metadata,
    clampedTime,
    videoWidth,
    videoHeight,
    displayWidth,
    displayHeight
  );
}

function setupExportProgressListener() {
  const api = window.electronAPI as any as StudioElectronAPI;
  if (!api || !api.onProcessingProgress) {
    logger.warn('onProcessingProgress not available');
    return;
  }

  api.onProcessingProgress((data: { percent: number; message: string }) => {
    updateExportProgress(data.percent, data.message);
  });
}

function showExportProgress() {
  const container = document.getElementById('export-progress-container');
  if (container) {
    container.style.display = 'block';
  }
}

function hideExportProgress() {
  const container = document.getElementById('export-progress-container');
  if (container) {
    container.style.display = 'none';
  }
}

function updateExportProgress(percent: number, message: string) {
  const progressFill = document.getElementById('export-progress-fill');
  const progressText = document.getElementById('export-progress-text');

  if (progressFill) {
    progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  if (progressText) {
    progressText.textContent = message || `${Math.round(percent)}%`;
  }
}

async function exportVideo() {
  if (!metadata || !videoPath || !metadataPath) {
    alert('Missing required data for export');
    return;
  }

  try {
    updateStatus('Exporting video...');
    showExportProgress();
    updateExportProgress(0, 'Starting export...');

    const api = window.electronAPI as any as StudioElectronAPI;
    if (!api || !api.exportVideo) {
      throw new Error('electronAPI.exportVideo not available');
    }
    const result = await api.exportVideo(videoPath, metadataPath, metadata);
    logger.info('Export complete:', result.outputPath);

    updateExportProgress(100, 'Export complete!');
    updateStatus(`Export complete: ${result.outputPath}`);

    // Hide progress bar after a short delay
    setTimeout(() => {
      hideExportProgress();
    }, 2000);

    alert(`Video exported successfully to:\n${result.outputPath}`);
  } catch (error) {
    logger.error('Export failed:', error);
    updateStatus(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    hideExportProgress();
    alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function updateStatus(message: string) {
  const statusText = document.getElementById('status-text');
  if (statusText) {
    statusText.textContent = message;
  }
}

// Debug: Log that script is loading
logger.info('Studio script loading...');
logger.debug('Window location:', window.location.href);
logger.debug('electronAPI available:', typeof window.electronAPI !== 'undefined');
logger.debug('Document ready state:', document.readyState);
logger.debug('Body exists:', !!document.body);
logger.debug('Studio container exists:', !!document.getElementById('studio-container'));

// Check if required elements exist
function checkDOMElements() {
  const required = [
    'studio-container',
    'video-element',
    'cursor-canvas',
    'zoom-canvas',
    'timeline',
    'play-pause-btn',
    'export-btn',
  ];

  const missing: string[] = [];
  required.forEach(id => {
    const el = document.getElementById(id);
    if (!el) {
      missing.push(id);
    }
  });

  if (missing.length > 0) {
    logger.error('Missing DOM elements:', missing);
    return false;
  }

  logger.debug('All required DOM elements found');
  return true;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    logger.debug('DOM loaded, checking elements...');
    if (checkDOMElements()) {
      logger.info('Initializing studio...');
      init().catch(err => {
        logger.error('Failed to initialize studio:', err);
        updateStatus(`Initialization failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      });
    } else {
      updateStatus('Missing required DOM elements');
    }
  });
} else {
  logger.debug('DOM already ready, checking elements...');
  if (checkDOMElements()) {
    logger.info('Initializing studio...');
    init().catch(err => {
      logger.error('Failed to initialize studio:', err);
      updateStatus(`Initialization failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    });
  } else {
    updateStatus('Missing required DOM elements');
  }
}

