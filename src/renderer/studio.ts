import type { RecordingMetadata, CursorKeyframe } from '../types/metadata';
import { Timeline } from './components/timeline';
import { VideoPreview } from './components/video-preview';
import { CursorEditor } from './components/cursor-editor';
import { ZoomEditor } from './components/zoom-editor';
import { KeyframePanel } from './components/keyframe-panel';
import { renderCursor, interpolateCursorPosition } from './utils/cursor-renderer';
import { renderZoom } from './utils/zoom-renderer';
import { createLogger } from '../utils/logger';

const logger = createLogger('Studio');

// Type definition for electronAPI - methods are available in studio context
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

// Extend Window interface to include electronAPI
declare global {
  interface Window {
    electronAPI?: StudioElectronAPI | {
      checkPermissions?: () => Promise<{
        screenRecording: boolean;
        accessibility: boolean;
      }>;
      requestPermissions?: () => Promise<void>;
      startRecording?: (config: any) => Promise<{ success: boolean }>;
      stopRecording?: (config: any) => Promise<{ success: boolean; outputPath: string; metadataPath?: string }>;
      getRecordingState?: () => Promise<{
        isRecording: boolean;
        startTime?: number;
        outputPath?: string;
      }>;
      selectOutputPath?: () => Promise<string | null>;
      onDebugLog?: (callback: (message: string) => void) => void;
      removeDebugLogListener?: () => void;
      onProcessingProgress?: (callback: (data: { percent: number; message: string }) => void) => void;
      removeProcessingProgressListener?: () => void;
      openStudio?: (videoPath: string, metadataPath: string) => Promise<{ success: boolean }>;
      selectVideoFile?: () => Promise<string | null>;
      selectMetadataFile?: () => Promise<string | null>;
      loadMetadata?: (metadataPath: string) => Promise<RecordingMetadata>;
      getVideoInfo?: (videoPath: string) => Promise<{
        width: number;
        height: number;
        frameRate: number;
        duration: number;
      }>;
      exportVideo?: (videoPath: string, metadataPath: string, metadata: RecordingMetadata) => Promise<{ success: boolean; outputPath: string }>;
    };
    __studioInitData?: {
      videoPath: string;
      metadataPath: string;
    };
  }
}

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
let animationFrameId: number | null = null;

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
    keyframePanel = new KeyframePanel('zoom-keyframes-list');
    logger.debug('KeyframePanel created');

    // Set up metadata update callbacks
    cursorEditor.setOnMetadataUpdate((updatedMetadata) => {
      metadata = updatedMetadata;
      updateTimelineDuration();
      keyframePanel?.setMetadata(updatedMetadata);
    });

    zoomEditor.setOnMetadataUpdate((updatedMetadata) => {
      metadata = updatedMetadata;
      updateTimelineDuration();
      keyframePanel?.setMetadata(updatedMetadata);
    });

    // Set up preview callbacks
    videoPreview.setOnTimeUpdate((time) => {
      currentTime = time;
      updateTimeDisplay();
      if (timeline) {
        timeline.updatePlayhead(time / 1000); // Convert to seconds
      }
      // Don't render here - use animation frame loop for smooth rendering
    });

    // Custom play/pause button is now always visible below the video

    // Set up animation frame loop for smooth cursor rendering
    setupAnimationFrameLoop();

    videoPreview.setOnSeek((time) => {
      videoPreview?.seekTo(time);
      // Render immediately after seek
      renderPreview();
    });

    timeline.setOnSeek((time) => {
      videoPreview?.seekTo(time);
      // Render immediately after seek
      renderPreview();
    });

    // Zoom updates are now handled through sections
    timeline.setOnZoomUpdate((sections) => {
      if (metadata && zoomEditor) {
        // Update zoom sections in metadata
        metadata.zoom.sections = sections;
        // Notify zoom editor of the update
        zoomEditor.setMetadata(metadata);
        // Update keyframe panel
        keyframePanel?.setMetadata(metadata);
        // Re-render preview
        renderPreview();
      }
    });

    // Set up keyframe panel callbacks
    keyframePanel.setOnSeek((time) => {
      videoPreview?.seekTo(time);
      // Render immediately after seek
      renderPreview();
    });

    keyframePanel.setOnDeleteZoomKeyframe((startTime) => {
      zoomEditor?.removeZoomSection(startTime);
    });

    keyframePanel.setOnUpdateZoomSegment((startTime, updates) => {
      zoomEditor?.updateZoomSection(startTime, updates);
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
    const api = window.electronAPI as StudioElectronAPI | undefined;
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

    // Wait for video metadata and ensure duration is available
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Video load timeout'));
      }, 10000);

      const checkDuration = () => {
        // Check if duration is valid (not NaN, not 0, is finite)
        if (videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0) {
          clearTimeout(timeout);
          resolve(undefined);
          return true;
        }
        return false;
      };

      // Try to get duration from loadedmetadata
      videoEl.addEventListener('loadedmetadata', () => {
        if (checkDuration()) return;
        // If duration not available yet, wait for loadeddata
        videoEl.addEventListener('loadeddata', () => {
          if (checkDuration()) return;
          // If still not available, wait a bit more and check again
          setTimeout(() => {
            if (!checkDuration()) {
              logger.warn('Video duration not available after load, using metadata duration as fallback');
              clearTimeout(timeout);
              resolve(undefined);
            }
          }, 500);
        }, { once: true });
      }, { once: true });

      videoEl.addEventListener('error', (e) => {
        clearTimeout(timeout);
        reject(new Error(`Video load error: ${videoEl.error?.message || 'Unknown error'}`));
      }, { once: true });
    });

    logger.info('Video loaded, duration:', videoEl.duration, 'seconds');
    logger.info('Metadata duration:', metadata?.video.duration, 'ms');

    // Auto-create cursor keyframes from clicks if there are clicks but few keyframes
    if (metadata) {
      autoCreateKeyframesFromClicks(metadata);
      // Note: Zoom sections are now generated on-demand, not pre-created from clicks
    }

    // Update timeline with metadata
    // Use actual video element duration as source of truth (convert from seconds to milliseconds)
    // This ensures the timeline matches the actual video length, not the metadata duration
    // Validate duration is valid before using it
    let actualVideoDurationMs: number;
    if (videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0) {
      actualVideoDurationMs = videoEl.duration * 1000;
      logger.info('Using video element duration:', actualVideoDurationMs, 'ms');
    } else {
      // Fallback to metadata duration if video element duration is invalid
      actualVideoDurationMs = metadata?.video.duration || 0;
      logger.warn('Video element duration invalid, using metadata duration:', actualVideoDurationMs, 'ms');
    }

    updateTimelineDuration();

    // Update editors and panel
    if (metadata) {
      cursorEditor?.setMetadata(metadata);
      zoomEditor?.setMetadata(metadata);
      keyframePanel?.setMetadata(metadata);

      // Set up settings panel with loaded metadata
      setupSettingsPanel();
    }

    updateStatus('Ready');
    logger.info('Studio data loaded successfully');

    // Render initial preview
    renderPreview();
  } catch (error) {
    logger.error('Failed to load studio data:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Error: ${errorMessage}`);
    alert(`Failed to load studio data: ${errorMessage}`);
  }
}

function setupSettingsPanel() {
  if (!metadata) return;

  // Get settings elements
  const cursorSizeSlider = document.getElementById('cursor-size-setting') as HTMLInputElement;
  const cursorSizeValue = document.getElementById('cursor-size-value-setting') as HTMLSpanElement;
  const cursorShapeSelect = document.getElementById('cursor-shape-setting') as HTMLSelectElement;
  const cursorColorInput = document.getElementById('cursor-color-setting') as HTMLInputElement;
  const cursorMotionBlurEnabledCheckbox = document.getElementById('cursor-motion-blur-enabled-setting') as HTMLInputElement;
  const cursorMotionBlurStrengthSlider = document.getElementById('cursor-motion-blur-strength-setting') as HTMLInputElement;
  const cursorMotionBlurStrengthValue = document.getElementById('cursor-motion-blur-strength-value-setting') as HTMLSpanElement;

  const zoomEnabledCheckbox = document.getElementById('zoom-enabled-setting') as HTMLInputElement;
  const zoomLevelSlider = document.getElementById('zoom-level-setting') as HTMLInputElement;
  const zoomLevelValue = document.getElementById('zoom-level-value-setting') as HTMLSpanElement;

  // Helper functions
  function updateCursorMotionBlurVisibility() {
    const motionBlurStrengthItem = document.getElementById('cursor-motion-blur-strength-setting-item');
    if (motionBlurStrengthItem) {
      motionBlurStrengthItem.style.display = cursorMotionBlurEnabledCheckbox.checked ? 'flex' : 'none';
    }
  }

  function updateZoomSettingsVisibility() {
    const zoomLevelItem = document.getElementById('zoom-level-setting-item');
    if (zoomLevelItem) {
      zoomLevelItem.style.display = zoomEnabledCheckbox.checked ? 'block' : 'none';
    }
  }

  // Load current settings from metadata
  if (metadata.cursor.config) {
    cursorSizeSlider.value = String(metadata.cursor.config.size || 100);
    cursorSizeValue.textContent = String(metadata.cursor.config.size || 100);
    cursorShapeSelect.value = metadata.cursor.config.shape || 'arrow';
    cursorColorInput.value = metadata.cursor.config.color || '#000000';

    // Initialize motion blur settings
    if (!metadata.cursor.config.motionBlur) {
      metadata.cursor.config.motionBlur = {
        enabled: false,
        strength: 0.5,
      };
    }
    cursorMotionBlurEnabledCheckbox.checked = metadata.cursor.config.motionBlur.enabled || false;
    const blurStrengthPercent = Math.round((metadata.cursor.config.motionBlur.strength || 0.5) * 100);
    cursorMotionBlurStrengthSlider.value = String(blurStrengthPercent);
    cursorMotionBlurStrengthValue.textContent = String(blurStrengthPercent);
    updateCursorMotionBlurVisibility();
  }

  if (metadata.zoom.config) {
    zoomEnabledCheckbox.checked = metadata.zoom.config.enabled || false;
    zoomLevelSlider.value = String(metadata.zoom.config.level || 2.0);
    zoomLevelValue.textContent = String(metadata.zoom.config.level || 2.0);
    updateZoomSettingsVisibility();
  }

  // Cursor settings
  cursorSizeSlider.addEventListener('input', (e) => {
    const value = (e.target as HTMLInputElement).value;
    cursorSizeValue.textContent = value;
    if (metadata) {
      metadata.cursor.config.size = parseInt(value);
      renderPreview();
    }
  });

  cursorShapeSelect.addEventListener('change', (e) => {
    if (metadata) {
      metadata.cursor.config.shape = (e.target as HTMLSelectElement).value as any;
      renderPreview();
    }
  });

  cursorColorInput.addEventListener('input', (e) => {
    if (metadata) {
      metadata.cursor.config.color = (e.target as HTMLInputElement).value;
      renderPreview();
    }
  });

  // Motion blur settings
  cursorMotionBlurEnabledCheckbox.addEventListener('change', () => {
    if (metadata) {
      if (!metadata.cursor.config.motionBlur) {
        metadata.cursor.config.motionBlur = {
          enabled: false,
          strength: 0.5,
        };
      }
      metadata.cursor.config.motionBlur.enabled = cursorMotionBlurEnabledCheckbox.checked;
      updateCursorMotionBlurVisibility();
      renderPreview();
    }
  });

  cursorMotionBlurStrengthSlider.addEventListener('input', (e) => {
    const value = (e.target as HTMLInputElement).value;
    const strength = parseFloat(value) / 100; // Convert 0-100 to 0-1
    cursorMotionBlurStrengthValue.textContent = value;
    if (metadata) {
      if (!metadata.cursor.config.motionBlur) {
        metadata.cursor.config.motionBlur = {
          enabled: false,
          strength: 0.5,
        };
      }
      metadata.cursor.config.motionBlur.strength = strength;
      renderPreview();
    }
  });

  // Zoom settings
  zoomEnabledCheckbox.addEventListener('change', () => {
    if (metadata) {
      metadata.zoom.config.enabled = zoomEnabledCheckbox.checked;
      updateZoomSettingsVisibility();
      renderPreview();
    }
  });

  zoomLevelSlider.addEventListener('input', (e) => {
    const value = (e.target as HTMLInputElement).value;
    zoomLevelValue.textContent = value;
    if (metadata) {
      metadata.zoom.config.level = parseFloat(value);
      renderPreview();
    }
  });

  // Initialize visibility
  updateZoomSettingsVisibility();
  updateCursorMotionBlurVisibility();
}

function setupEventListeners() {
  const playPauseBtn = document.getElementById('play-pause-btn');
  const skipBackwardBtn = document.getElementById('skip-backward-btn');
  const skipForwardBtn = document.getElementById('skip-forward-btn');
  const exportBtn = document.getElementById('export-btn');

  const togglePlayPause = async () => {
    if (!videoPreview) return;

    if (isPlaying) {
      videoPreview.pause();
    } else {
      await videoPreview.play();
    }
  };

  const skipBackward = () => {
    if (!videoPreview) return;
    const videoEl = videoPreview.getVideoElement();
    const currentTime = videoEl.currentTime;
    videoEl.currentTime = Math.max(0, currentTime - 5); // Skip back 5 seconds
    renderPreview();
  };

  const skipForward = () => {
    if (!videoPreview) return;
    const videoEl = videoPreview.getVideoElement();
    const duration = videoEl.duration;
    const currentTime = videoEl.currentTime;
    videoEl.currentTime = Math.min(duration, currentTime + 5); // Skip forward 5 seconds
    renderPreview();
  };

  // Toolbar play/pause button
  playPauseBtn?.addEventListener('click', togglePlayPause);

  // Skip buttons
  skipBackwardBtn?.addEventListener('click', skipBackward);
  skipForwardBtn?.addEventListener('click', skipForward);

  // Update play/pause button states
  const videoEl = videoPreview?.getVideoElement();
  if (videoEl) {
    const updatePlayPauseState = (playing: boolean) => {
      isPlaying = playing;

      // Update toolbar button classes
      const btn = document.getElementById('play-pause-btn');
      if (btn) {
        const playIcon = btn.querySelector('.play-icon') as HTMLElement;
        const pauseIcon = btn.querySelector('.pause-icon') as HTMLElement;

        if (playing) {
          btn.classList.add('playing');
          if (playIcon) playIcon.style.display = 'none';
          if (pauseIcon) pauseIcon.style.display = 'block';
        } else {
          btn.classList.remove('playing');
          if (playIcon) playIcon.style.display = 'block';
          if (pauseIcon) pauseIcon.style.display = 'none';
        }
      }
    };

    videoEl.addEventListener('play', () => {
      updatePlayPauseState(true);
      // Start animation frame loop when playing
      startAnimationFrameLoop();
    });

    videoEl.addEventListener('pause', () => {
      updatePlayPauseState(false);
      // Stop animation frame loop when paused
      stopAnimationFrameLoop();
      // Render once when paused to show current frame
      renderPreview();
    });
  }

  exportBtn?.addEventListener('click', async () => {
    if (!metadata) {
      alert('No metadata loaded');
      return;
    }
    await exportVideo();
  });

  // Add zoom section button
  const addZoomSectionBtn = document.getElementById('add-zoom-section-btn');
  addZoomSectionBtn?.addEventListener('click', () => {
    if (!metadata || !videoPreview || !zoomEditor) {
      alert('No video loaded');
      return;
    }

    const videoEl = videoPreview.getVideoElement();
    const currentTimeMs = videoEl.currentTime * 1000; // Current playhead position in ms
    const videoDurationMs = getActualVideoDuration();

    // Default section: 2 seconds duration, centered at current time
    const sectionDuration = 2000; // 2 seconds
    const startTime = Math.max(0, currentTimeMs - sectionDuration / 2);
    const endTime = Math.min(videoDurationMs, startTime + sectionDuration);

    // Default zoom: 2x scale, centered on video
    const scale = metadata.zoom.config.level || 2.0;
    const centerX = metadata.video.width / 2;
    const centerY = metadata.video.height / 2;

    // Add the section
    zoomEditor.addZoomSection(startTime, endTime, scale, centerX, centerY);

    logger.info(`Added zoom section: ${startTime}ms - ${endTime}ms, scale: ${scale}x`);
  });
}

/**
 * Get actual video duration in milliseconds
 */
function getActualVideoDuration(): number {
  if (!videoPreview) return 0;
  const videoEl = videoPreview.getVideoElement();
  if (!videoEl || !videoEl.duration || !isFinite(videoEl.duration) || videoEl.duration <= 0) {
    return 0;
  }
  return videoEl.duration * 1000; // Convert to milliseconds
}

/**
 * Update timeline with actual video duration
 */
function updateTimelineDuration() {
  if (!timeline || !metadata) return;
  const actualDuration = getActualVideoDuration();
  if (actualDuration > 0) {
    timeline.setMetadata(metadata, actualDuration);
  }
}

function updateTimeDisplay() {
  const timeDisplay = document.getElementById('time-display');
  if (!timeDisplay || !videoPreview || !metadata) return;

  const current = formatTime(currentTime / 1000);
  const actualDuration = getActualVideoDuration() / 1000; // Convert to seconds
  const total = formatTime(actualDuration);
  timeDisplay.textContent = `${current} / ${total}`;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateCursorPositionDisplay(timestamp: number, videoWidth: number, videoHeight: number): void {
  if (!metadata) return;

  const cursorPos = interpolateCursorPosition(metadata.cursor.keyframes, timestamp);
  const cursorPositionEl = document.getElementById('cursor-position');

  if (cursorPositionEl && cursorPos) {
    // Display cursor position in video coordinates
    cursorPositionEl.textContent = `Cursor: (${Math.round(cursorPos.x)}, ${Math.round(cursorPos.y)})`;
  } else if (cursorPositionEl) {
    cursorPositionEl.textContent = 'Cursor: (—, —)';
  }
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

  const videoWidth = metadata.video.width;
  const videoHeight = metadata.video.height;

  // Calculate the actual video content area within the video element
  // The video element preserves aspect ratio, so we need to account for letterboxing
  const videoAspectRatio = videoWidth / videoHeight;
  const containerAspectRatio = videoRect.width / videoRect.height;

  // Determine actual video content dimensions within the video element
  let actualVideoDisplayWidth: number;
  let actualVideoDisplayHeight: number;

  if (videoAspectRatio > containerAspectRatio) {
    // Video is wider - fits to width, letterboxed top/bottom
    actualVideoDisplayWidth = videoRect.width;
    actualVideoDisplayHeight = videoRect.width / videoAspectRatio;
  } else {
    // Video is taller - fits to height, pillarboxed left/right
    actualVideoDisplayWidth = videoRect.height * videoAspectRatio;
    actualVideoDisplayHeight = videoRect.height;
  }

  // Update canvas positions and sizes to match video element
  // Canvas should match the video element's bounding rect for proper overlay
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

  // Get current time directly from video element for accurate synchronization
  // Convert from seconds to milliseconds
  const videoCurrentTime = videoEl.currentTime * 1000;
  // Use actual video element duration
  const videoDuration = getActualVideoDuration();
  const clampedTime = Math.min(videoCurrentTime, videoDuration || Infinity);

  // Update currentTime for display purposes
  currentTime = clampedTime;

  // Calculate offset of video content within the video element (for letterboxing)
  const videoContentOffsetX = (videoRect.width - actualVideoDisplayWidth) / 2;
  const videoContentOffsetY = (videoRect.height - actualVideoDisplayHeight) / 2;

  // Render cursor - account for video content offset within the canvas
  // The canvas is sized to the video element (which includes letterboxing),
  // but the video content is centered within it
  const ctx = cursorCanvas.getContext('2d');
  if (ctx) {
    // Clear canvas first (before translation)
    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    // Translate to video content area
    ctx.save();
    ctx.translate(videoContentOffsetX, videoContentOffsetY);

    // Render cursor relative to video content area (no offsets needed since we translated)
    // Pass content dimensions so scale is calculated correctly
    renderCursor(
      cursorCanvas,
      metadata,
      clampedTime,
      videoWidth,
      videoHeight,
      actualVideoDisplayWidth,
      actualVideoDisplayHeight
    );

    ctx.restore();

    // Update cursor position display
    updateCursorPositionDisplay(clampedTime, videoWidth, videoHeight);
  }

  // Render zoom - account for video content offset (same approach as cursor)
  const zoomCtx = zoomCanvas.getContext('2d');
  if (zoomCtx) {
    // Clear canvas first (before translation)
    zoomCtx.clearRect(0, 0, zoomCanvas.width, zoomCanvas.height);

    // Translate to video content area
    zoomCtx.save();
    zoomCtx.translate(videoContentOffsetX, videoContentOffsetY);

    // Render zoom relative to video content area
    renderZoom(
      zoomCanvas,
      metadata,
      clampedTime,
      videoWidth,
      videoHeight,
      actualVideoDisplayWidth,
      actualVideoDisplayHeight
    );

    zoomCtx.restore();
  }
}

function setupAnimationFrameLoop() {
  // Animation frame loop will be started/stopped by play/pause events
}

function startAnimationFrameLoop() {
  // Cancel any existing loop
  stopAnimationFrameLoop();

  // Start new animation frame loop
  function animate() {
    if (isPlaying && videoPreview) {
      // Render preview with current video time
      renderPreview();
      animationFrameId = requestAnimationFrame(animate);
    } else {
      animationFrameId = null;
    }
  }

  animationFrameId = requestAnimationFrame(animate);
}

function stopAnimationFrameLoop() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function setupExportProgressListener() {
  const api = window.electronAPI as StudioElectronAPI | undefined;
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

    const api = window.electronAPI as StudioElectronAPI | undefined;
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

/**
 * Automatically create cursor keyframes from click events if there are clicks
 * but few or no cursor keyframes. This helps populate the editor with the
 * actual click positions from the recording.
 */
function autoCreateKeyframesFromClicks(metadata: RecordingMetadata) {
  if (!metadata.clicks || metadata.clicks.length === 0) {
    return; // No clicks to convert
  }

  // Get click "down" events (actual clicks, not releases)
  const clickDownEvents = metadata.clicks.filter(c => c.action === 'down');

  if (clickDownEvents.length === 0) {
    return; // No actual clicks
  }

  // Use original click timestamps without normalization
  // This preserves the original timing relative to the video
  const clicks = clickDownEvents;

  // Check if we should auto-create keyframes
  // Only create if there are significantly more clicks than keyframes
  const existingKeyframes = metadata.cursor.keyframes.length;
  const clickCount = clicks.length;

  // Early exit: if we already have enough keyframes, skip
  // We expect 1 keyframe per click, so check for that
  if (existingKeyframes >= clickCount) {
    logger.debug(`Skipping auto-create: ${existingKeyframes} keyframes already exist for ${clickCount} clicks`);
    return;
  }

  // If there are clicks but very few keyframes (less than the number of clicks),
  // auto-create keyframes from clicks
  if (existingKeyframes < clickCount) {
    const startTime = performance.now();
    logger.info(`Auto-creating cursor keyframes from ${clickCount} clicks (existing: ${existingKeyframes})`);

    // Get initial cursor position (first keyframe or first click position)
    let initialX = 0;
    let initialY = 0;
    const hasExistingKeyframes = metadata.cursor.keyframes.length > 0;

    if (hasExistingKeyframes) {
      initialX = metadata.cursor.keyframes[0].x;
      initialY = metadata.cursor.keyframes[0].y;
    } else if (clicks.length > 0) {
      initialX = clicks[0].x;
      initialY = clicks[0].y;
    }

    // Clear existing keyframes if we're auto-creating from scratch
    if (!hasExistingKeyframes) {
      metadata.cursor.keyframes = [];

      // Add initial keyframe at timestamp 0
      metadata.cursor.keyframes.push({
        timestamp: 0,
        x: initialX,
        y: initialY,
      });
    }

    const minKeyframeSpacing = 10; // Minimum spacing between keyframes in milliseconds

    // Collect all new keyframes first, then deduplicate
    const newKeyframes: CursorKeyframe[] = [];

    // Add keyframes for each click - just create keyframes at click positions
    // Smooth motion will be handled by the SmoothPosition2D smoother
    for (let i = 0; i < clicks.length; i++) {
      const click = clicks[i];

      // Keyframe at the click timestamp, at current click's position
      newKeyframes.push({
        timestamp: click.timestamp,
        x: click.x,
        y: click.y,
      });
    }

    // Add new keyframes to existing ones
    metadata.cursor.keyframes.push(...newKeyframes);

    // Sort keyframes by timestamp (single pass, O(n log n))
    metadata.cursor.keyframes.sort((a, b) => a.timestamp - b.timestamp);

    // Deduplicate keyframes - ensure each timestamp is unique
    // Optimized: single pass through sorted array
    const deduplicated: CursorKeyframe[] = [];
    const totalKeyframes = metadata.cursor.keyframes.length;

    for (let i = 0; i < totalKeyframes; i++) {
      const current = metadata.cursor.keyframes[i];

      // Check if this keyframe is too close to the previous one
      if (deduplicated.length > 0) {
        const last = deduplicated[deduplicated.length - 1];
        const timeDiff = current.timestamp - last.timestamp;

        if (timeDiff < minKeyframeSpacing) {
          // Too close - merge by keeping the later one (prefer click position over "before" position)
          if (current.timestamp >= last.timestamp) {
            deduplicated[deduplicated.length - 1] = current;
          }
          // Otherwise keep the existing one
          continue;
        }
      }

      // Far enough from previous keyframe - add it
      deduplicated.push(current);
    }

    // Replace with deduplicated array
    metadata.cursor.keyframes = deduplicated;

    // Ensure there's a final keyframe at the end of the video
    const actualVideoDuration = getActualVideoDuration() || metadata.video.duration;
    const lastKeyframe = metadata.cursor.keyframes[metadata.cursor.keyframes.length - 1];

    if (!lastKeyframe || lastKeyframe.timestamp < actualVideoDuration - 100) {
      // Add final keyframe at the last click position or last keyframe position
      const finalX = lastKeyframe?.x || clicks[clicks.length - 1]?.x || initialX;
      const finalY = lastKeyframe?.y || clicks[clicks.length - 1]?.y || initialY;

      metadata.cursor.keyframes.push({
        timestamp: actualVideoDuration,
        x: finalX,
        y: finalY,
      });
    }

    const endTime = performance.now();
    logger.info(`Created ${metadata.cursor.keyframes.length} cursor keyframes from clicks in ${(endTime - startTime).toFixed(2)}ms`);
  }
}

// Zoom sections are now generated on-demand from mouse events during rendering
// No need to pre-create zoom keyframes from clicks

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

