import type { RecordingMetadata, CursorKeyframe } from '../types/metadata';
import { Timeline } from './components/timeline';
import { VideoPreview } from './components/video-preview';
import { CursorEditor } from './components/cursor-editor';
import { ZoomEditor } from './components/zoom-editor';
import { KeyframePanel } from './components/keyframe-panel';
import { renderCursor, interpolateCursorPosition, resetCursorSmoothing } from './utils/cursor-renderer';
import { renderZoom } from './utils/zoom-renderer';
import { createLogger } from '../utils/logger';
import { MetadataManager } from '../processing/metadata-manager';

const logger = createLogger('Studio');

// Metadata manager instance
let metadataManager: MetadataManager | null = null;

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
  saveMetadata: (filePath: string, metadata: object) => Promise<{ success: boolean }>;
  reloadMetadata: (filePath: string) => Promise<{ success: boolean; data?: RecordingMetadata }>;
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

// Playback constants
const FRAME_TIME = 1 / 30; // Approximate frame duration at 30fps
const SKIP_SECONDS = 5;

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
      renderPreview();
    });

    zoomEditor.setOnMetadataUpdate((updatedMetadata) => {
      metadata = updatedMetadata;
      updateTimelineDuration();
      keyframePanel?.setMetadata(updatedMetadata);
      renderPreview();
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
      // Reset cursor smoothing on seek for accurate positioning
      resetCursorSmoothing();
      // Render immediately after seek
      renderPreview();
    });

    timeline.setOnSeek((time) => {
      videoPreview?.seekTo(time);
      // Reset cursor smoothing on seek for accurate positioning
      resetCursorSmoothing();
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
      // Reset cursor smoothing on seek for accurate positioning
      resetCursorSmoothing();
      // Render immediately after seek
      renderPreview();
    });

    keyframePanel.setOnDeleteZoomKeyframe((startTime) => {
      zoomEditor?.removeZoomSection(startTime);
    });

    keyframePanel.setOnUpdateZoomSegment((startTime, updates) => {
      zoomEditor?.updateZoomSection(startTime, updates);
    });

    // Sync selection between timeline and keyframe panel
    keyframePanel.setOnSelectZoomSection((startTime) => {
      // When keyframe panel selects, also select in timeline
      timeline?.selectZoomSectionByStartTime(startTime);
    });

    timeline.setOnZoomSectionSelect((startTime) => {
      // When timeline selects, also select in keyframe panel
      keyframePanel?.selectZoomSection(startTime);
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

    // Initialize metadata manager
    metadataManager = new MetadataManager(metadata);

    // Reset cursor smoothing for new video
    resetCursorSmoothing();

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

    // Initialize motion blur settings
    if (!metadata.cursor.config.motionBlur) {
      metadata.cursor.config.motionBlur = {
        enabled: true,
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

  // Motion blur settings
  cursorMotionBlurEnabledCheckbox.addEventListener('change', () => {
    if (metadata) {
      if (!metadata.cursor.config.motionBlur) {
        metadata.cursor.config.motionBlur = {
          enabled: true,
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
          enabled: true,
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
    videoEl.currentTime = Math.max(0, videoEl.currentTime - SKIP_SECONDS);
    resetCursorSmoothing();
    renderPreview();
  };

  const skipForward = () => {
    if (!videoPreview) return;
    const videoEl = videoPreview.getVideoElement();
    videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + SKIP_SECONDS);
    resetCursorSmoothing();
    renderPreview();
  };

  const stepFrame = (direction: 1 | -1) => {
    if (!videoPreview) return;
    const videoEl = videoPreview.getVideoElement();
    const newTime = videoEl.currentTime + direction * FRAME_TIME;
    videoEl.currentTime = Math.max(0, Math.min(videoEl.duration, newTime));
    resetCursorSmoothing();
    renderPreview();
  };

  const goToStart = () => {
    if (!videoPreview) return;
    videoPreview.getVideoElement().currentTime = 0;
    resetCursorSmoothing();
    renderPreview();
  };

  const goToEnd = () => {
    if (!videoPreview) return;
    const videoEl = videoPreview.getVideoElement();
    videoEl.currentTime = videoEl.duration;
    resetCursorSmoothing();
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

  // Suggest zoom button - analyzes cursor movement and clicks to find important regions
  const suggestZoomBtn = document.getElementById('suggest-zoom-btn');
  suggestZoomBtn?.addEventListener('click', () => {
    if (!metadata || !zoomEditor) {
      alert('No video loaded');
      return;
    }

    const keyframes = metadata.cursor.keyframes;
    const clicks = metadata.clicks || [];
    if (!keyframes || keyframes.length < 10) {
      alert('Not enough cursor data to analyze');
      return;
    }

    const videoDurationMs = getActualVideoDuration();
    const scale = metadata.zoom.config.level || 2.0;
    const existingSections = metadata.zoom.sections || [];
    const videoWidth = metadata.video.width;
    const videoHeight = metadata.video.height;

    // Parameters for detection
    const minDwellTime = 600; // Minimum dwell time (ms)
    const maxMovementRadius = 600; // Maximum movement radius to consider "staying still"
    const minGapBetweenSections = 2500; // Minimum gap between sections (ms)
    const sectionPadding = 500; // Padding before/after detected region (ms)
    const minSectionDuration = 2000; // Minimum section duration (ms)
    const maxSectionDuration = 3500; // Maximum section duration (ms)

    interface Candidate {
      startTime: number;
      endTime: number;
      centerX: number;
      centerY: number;
      score: number; // Higher is better
      hasClick: boolean;
    }

    const candidates: Candidate[] = [];

    // Calculate viewport bounds at this zoom scale
    // The visible area is videoWidth/scale by videoHeight/scale centered at the zoom point
    const viewportWidth = videoWidth / scale;
    const viewportHeight = videoHeight / scale;
    // Small margin so cursor doesn't touch the very edge (3% padding from edge)
    const viewportMarginX = viewportWidth * 0.03;
    const viewportMarginY = viewportHeight * 0.03;
    const effectiveViewportHalfWidth = (viewportWidth / 2) - viewportMarginX;
    const effectiveViewportHalfHeight = (viewportHeight / 2) - viewportMarginY;

    // Helper function to find optimal center and trim end time if cursor leaves viewport
    const findOptimalCenter = (startTime: number, endTime: number): { centerX: number; centerY: number; endTime: number; valid: boolean } => {
      // Get all keyframes within the time range
      const sectionKeyframes = keyframes.filter(kf =>
        kf.timestamp >= startTime && kf.timestamp <= endTime
      );

      if (sectionKeyframes.length === 0) {
        return { centerX: 0, centerY: 0, endTime, valid: false };
      }

      // Use the first part of keyframes to establish center (before cursor might move away)
      const initialKeyframes = sectionKeyframes.slice(0, Math.max(3, Math.floor(sectionKeyframes.length / 2)));

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const kf of initialKeyframes) {
        minX = Math.min(minX, kf.x);
        maxX = Math.max(maxX, kf.x);
        minY = Math.min(minY, kf.y);
        maxY = Math.max(maxY, kf.y);
      }

      // Calculate center from initial keyframes
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // Clamp center to ensure viewport stays within video bounds
      const clampedCenterX = Math.max(viewportWidth / 2, Math.min(videoWidth - viewportWidth / 2, centerX));
      const clampedCenterY = Math.max(viewportHeight / 2, Math.min(videoHeight - viewportHeight / 2, centerY));

      // Find the last keyframe where cursor is still in viewport
      let adjustedEndTime = endTime;
      for (const kf of sectionKeyframes) {
        const dx = Math.abs(kf.x - clampedCenterX);
        const dy = Math.abs(kf.y - clampedCenterY);
        if (dx > effectiveViewportHalfWidth || dy > effectiveViewportHalfHeight) {
          // Cursor left viewport, end zoom just before this
          adjustedEndTime = Math.max(startTime + 1000, kf.timestamp - 200);
          break;
        }
      }

      // Check if we have enough duration (at least 1 second)
      if (adjustedEndTime - startTime < 1000) {
        return { centerX: 0, centerY: 0, endTime, valid: false };
      }

      return { centerX: clampedCenterX, centerY: clampedCenterY, endTime: adjustedEndTime, valid: true };
    };

    // Method 1: Find click events with dwell time around them
    for (const click of clicks) {
      const clickTime = click.timestamp;

      // Find keyframes around this click
      const nearbyKeyframes = keyframes.filter(kf =>
        Math.abs(kf.timestamp - clickTime) < 1500
      );

      if (nearbyKeyframes.length < 3) continue;

      // Calculate average position and movement
      let sumX = 0, sumY = 0;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

      for (const kf of nearbyKeyframes) {
        sumX += kf.x;
        sumY += kf.y;
        minX = Math.min(minX, kf.x);
        maxX = Math.max(maxX, kf.x);
        minY = Math.min(minY, kf.y);
        maxY = Math.max(maxY, kf.y);
      }

      const avgX = sumX / nearbyKeyframes.length;
      const avgY = sumY / nearbyKeyframes.length;
      const movementRadius = Math.max(maxX - minX, maxY - minY) / 2;

      // Score based on how still the cursor is
      if (movementRadius < maxMovementRadius * 1.5) {
        const startTime = Math.max(0, clickTime - sectionPadding);
        const endTime = Math.min(videoDurationMs, clickTime + minSectionDuration);

        // Find optimal center and trim end time if cursor leaves viewport
        const optimal = findOptimalCenter(startTime, endTime);
        if (!optimal.valid) continue;

        candidates.push({
          startTime,
          endTime: optimal.endTime,
          centerX: optimal.centerX,
          centerY: optimal.centerY,
          score: 100 - movementRadius + 50, // Bonus for having a click
          hasClick: true
        });
      }
    }

    // Method 2: Find dwell regions (cursor stays still)
    let i = 0;
    while (i < keyframes.length) {
      const startKeyframe = keyframes[i];
      let endIndex = i;
      let sumX = startKeyframe.x, sumY = startKeyframe.y;
      let count = 1;

      // Use a sliding window approach
      const centerX = startKeyframe.x;
      const centerY = startKeyframe.y;

      // Expand window while cursor stays within radius
      while (endIndex < keyframes.length - 1) {
        const nextKeyframe = keyframes[endIndex + 1];
        const dx = nextKeyframe.x - centerX;
        const dy = nextKeyframe.y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > maxMovementRadius) break;

        sumX += nextKeyframe.x;
        sumY += nextKeyframe.y;
        count++;
        endIndex++;
      }

      const dwellTime = keyframes[endIndex].timestamp - startKeyframe.timestamp;

      if (dwellTime >= minDwellTime) {
        const avgX = sumX / count;
        const avgY = sumY / count;

        // Check if there's a click in this region
        const hasClick = clicks.some(c =>
          c.timestamp >= startKeyframe.timestamp &&
          c.timestamp <= keyframes[endIndex].timestamp
        );

        // Calculate score based on dwell time and position
        // Prefer regions not at screen edges
        const edgeMargin = 0.15;
        const isNearEdge =
          avgX < videoWidth * edgeMargin ||
          avgX > videoWidth * (1 - edgeMargin) ||
          avgY < videoHeight * edgeMargin ||
          avgY > videoHeight * (1 - edgeMargin);

        const edgePenalty = isNearEdge ? 30 : 0;
        const dwellBonus = Math.min(dwellTime / 50, 40); // More dwell = better, capped
        const clickBonus = hasClick ? 40 : 0;

        const startTime = Math.max(0, startKeyframe.timestamp - sectionPadding);
        const endTime = Math.min(
          videoDurationMs,
          keyframes[endIndex].timestamp + sectionPadding,
          startTime + maxSectionDuration
        );

        if (endTime - startTime >= minSectionDuration) {
          // Find optimal center and trim end time if cursor leaves viewport
          const optimal = findOptimalCenter(startTime, endTime);
          if (optimal.valid) {
            candidates.push({
              startTime,
              endTime: optimal.endTime,
              centerX: optimal.centerX,
              centerY: optimal.centerY,
              score: dwellBonus + clickBonus - edgePenalty,
              hasClick
            });
          }
        }

        // Skip past this region
        i = endIndex + 1;
      } else {
        i++;
      }
    }

    if (candidates.length === 0) {
      showToast('No suitable zoom regions found', 'error');
      return;
    }

    // Divide timeline into segments and pick best from each for better distribution
    const numSegments = Math.min(5, Math.ceil(videoDurationMs / 15000)); // ~15 sec segments
    const segmentDuration = videoDurationMs / numSegments;

    // Group candidates by segment
    const segmentCandidates: Candidate[][] = Array.from({ length: numSegments }, () => []);
    for (const candidate of candidates) {
      const segmentIndex = Math.min(
        numSegments - 1,
        Math.floor(candidate.startTime / segmentDuration)
      );
      segmentCandidates[segmentIndex].push(candidate);
    }

    // Sort each segment by score
    for (const segment of segmentCandidates) {
      segment.sort((a, b) => b.score - a.score);
    }

    // Select candidates round-robin from segments, respecting constraints
    const selectedSections: Candidate[] = [];
    const usedSegments = new Set<number>();

    // Keep trying until we can't add more
    let changed = true;
    while (changed) {
      changed = false;

      for (let segIdx = 0; segIdx < numSegments; segIdx++) {
        const segment = segmentCandidates[segIdx];
        if (segment.length === 0) continue;

        // Find best candidate from this segment that doesn't overlap
        for (let i = 0; i < segment.length; i++) {
          const candidate = segment[i];

          // Check overlap with existing sections
          const overlapsExisting = existingSections.some(s =>
            candidate.startTime < s.endTime && candidate.endTime > s.startTime
          );

          // Check overlap with already selected sections (with gap)
          const overlapsSelected = selectedSections.some(s =>
            candidate.startTime < s.endTime + minGapBetweenSections &&
            candidate.endTime > s.startTime - minGapBetweenSections
          );

          if (!overlapsExisting && !overlapsSelected) {
            selectedSections.push(candidate);
            segment.splice(i, 1); // Remove from candidates
            changed = true;
            break;
          }
        }
      }
    }

    if (selectedSections.length === 0) {
      showToast('No suitable zoom regions found', 'error');
      return;
    }

    // Sort by time for adding
    selectedSections.sort((a, b) => a.startTime - b.startTime);

    // Add the sections
    for (const section of selectedSections) {
      zoomEditor.addZoomSection(
        section.startTime,
        section.endTime,
        scale,
        section.centerX,
        section.centerY
      );
    }

    showToast(`Added ${selectedSections.length} zoom section${selectedSections.length > 1 ? 's' : ''}`);
    logger.info(`Suggested ${selectedSections.length} zoom sections`);
  });

  // Toast notification helper
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  };

  // Save function
  const saveProject = async () => {
    if (!metadataManager || !metadataManager.hasMetadata() || !metadataPath) {
      showToast('No metadata loaded', 'error');
      return;
    }

    const fullMetadata = metadataManager.getMetadata();
    if (!fullMetadata) {
      showToast('No metadata to save', 'error');
      return;
    }

    try {
      const api = window.electronAPI as StudioElectronAPI | undefined;
      if (!api?.saveMetadata) {
        showToast('Save functionality not available', 'error');
        return;
      }

      const result = await api.saveMetadata(metadataPath, fullMetadata);
      if (result.success) {
        showToast('Saved');
        logger.info(`Metadata saved to: ${metadataPath}`);
      }
    } catch (error) {
      logger.error('Failed to save metadata:', error);
      showToast('Failed to save', 'error');
    }
  };

  // Save metadata button
  const saveMetadataBtn = document.getElementById('save-metadata-btn');
  saveMetadataBtn?.addEventListener('click', () => saveProject());

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in input fields
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      // Still allow Cmd+S in inputs
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveProject();
      }
      return;
    }

    // Cmd+S / Ctrl+S - Save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveProject();
      return;
    }

    // Space - Play/Pause
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
      return;
    }

    // Left Arrow - Step back (frame when paused, 5s when playing)
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (isPlaying) {
        skipBackward();
      } else {
        stepFrame(-1);
      }
      return;
    }

    // Right Arrow - Step forward (frame when paused, 5s when playing)
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (isPlaying) {
        skipForward();
      } else {
        stepFrame(1);
      }
      return;
    }

    // J - Rewind 5 seconds
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      skipBackward();
      return;
    }

    // K - Pause
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      if (videoPreview && isPlaying) {
        videoPreview.pause();
      }
      return;
    }

    // L - Forward 5 seconds
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      skipForward();
      return;
    }

    // Home - Go to start
    if (e.key === 'Home') {
      e.preventDefault();
      goToStart();
      return;
    }

    // End - Go to end
    if (e.key === 'End') {
      e.preventDefault();
      goToEnd();
      return;
    }

    // , (comma) - Step back one frame
    if (e.key === ',') {
      e.preventDefault();
      stepFrame(-1);
      return;
    }

    // . (period) - Step forward one frame
    if (e.key === '.') {
      e.preventDefault();
      stepFrame(1);
      return;
    }
  });

  // Load (reload) metadata button
  const loadMetadataBtn = document.getElementById('load-metadata-btn');
  loadMetadataBtn?.addEventListener('click', async () => {
    if (!metadataPath || !zoomEditor || !timeline) {
      alert('No video loaded');
      return;
    }

    if (!confirm('Reload from file? Any unsaved changes will be lost.')) {
      return;
    }

    try {
      const api = window.electronAPI as StudioElectronAPI | undefined;
      if (!api?.reloadMetadata) {
        alert('Reload functionality not available');
        return;
      }

      const result = await api.reloadMetadata(metadataPath);
      if (!result.success || !result.data) {
        alert('Failed to reload metadata');
        return;
      }

      // Update metadata and manager
      metadata = result.data;
      metadataManager = new MetadataManager(metadata);

      // Refresh UI
      timeline.setMetadata(metadata, getActualVideoDuration());
      zoomEditor.setMetadata(metadata);
      keyframePanel?.setMetadata(metadata);
      renderPreview();

      logger.info(`Metadata reloaded from: ${metadataPath}`);
    } catch (error) {
      logger.error('Failed to reload metadata:', error);
      alert(`Failed to reload metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
 *
 * NOTE: This is only needed for legacy metadata that doesn't include all move events.
 * New recordings include all mouse positions as keyframes.
 */
function autoCreateKeyframesFromClicks(metadata: RecordingMetadata) {
  // Skip if we already have a good number of keyframes (new recordings include all positions)
  const existingKeyframes = metadata.cursor.keyframes.length;
  if (existingKeyframes > 100) {
    logger.debug(`Skipping auto-create: ${existingKeyframes} keyframes already exist (sufficient coverage)`);
    return;
  }

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
  const clickCount = clicks.length;

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

    // Sort keyframes by timestamp
    metadata.cursor.keyframes.sort((a, b) => a.timestamp - b.timestamp);

    // Deduplicate keyframes - ensure each timestamp is unique
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

