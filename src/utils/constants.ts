/**
 * Application-wide constants
 */

/**
 * Default frame rate for video recording and processing
 * All videos are recorded and processed at 30fps
 */
export const DEFAULT_FRAME_RATE = 30;

// ========================================
// Video Processing Constants
// ========================================

/**
 * FFmpeg CRF (Constant Rate Factor) for video encoding
 * Lower values = higher quality (18 is high quality)
 */
export const VIDEO_ENCODING_CRF = 18;

/** Batch size for parallel frame processing */
export const FRAME_BATCH_SIZE = 100;

/**
 * Frame number padding width (for frame_000001.png format)
 */
export const FRAME_NUMBER_PADDING = 6;

// ========================================
// Cursor Configuration Defaults
// ========================================

/**
 * Default cursor size in pixels
 */
export const DEFAULT_CURSOR_SIZE = 150;

/**
 * Minimum cursor size in pixels
 */
const MIN_CURSOR_SIZE = 20;

/**
 * Maximum cursor size in pixels
 */
const MAX_CURSOR_SIZE = 400;

/**
 * Default cursor color (black)
 */
export const DEFAULT_CURSOR_COLOR = '#000000';

/**
 * Default cursor shape
 */
export const DEFAULT_CURSOR_SHAPE = 'arrow';

// ========================================
// Cursor Animation Constants
// ========================================

/**
 * Pixels threshold - cursor is considered static if movement < this
 */
export const CURSOR_STATIC_THRESHOLD = 2;

/**
 * Hide cursor after this many milliseconds of no movement (when hideWhenStatic is enabled)
 */
export const CURSOR_HIDE_AFTER_MS = 1000;

/**
 * Duration in seconds for cursor loop position animation (return to initial position)
 */
export const CURSOR_LOOP_DURATION_SECONDS = 0.5;

/**
 * Cursor click animation duration in milliseconds
 */
export const CURSOR_CLICK_ANIMATION_DURATION_MS = 200;

/**
 * Cursor click animation scale down amount (0-1)
 */
export const CURSOR_CLICK_ANIMATION_SCALE = 0.7;

// ========================================
// Zoom Configuration Constants
// ========================================

/**
 * Default dead zone radius for zoom (prevents micro-movements)
 */
const DEFAULT_ZOOM_DEAD_ZONE = 15;

/**
 * Focus required duration in milliseconds before zoom activates
 */
const ZOOM_FOCUS_REQUIRED_MS = 2000;

/**
 * Max movement in logical pixels to be considered "focused"
 */
const ZOOM_FOCUS_THRESHOLD = 80;

/**
 * Must stay within this radius to maintain focus
 */
const ZOOM_FOCUS_AREA_RADIUS = 150;

/**
 * Zoom transition speed (how fast to transition zoom in/out)
 * Lower values = slower, smoother transitions
 */
const ZOOM_TRANSITION_SPEED = 0.03;

/**
 * Zoom out speed multiplier (zoom out faster than zoom in)
 */
const ZOOM_OUT_SPEED_MULTIPLIER = 3;

/**
 * Velocity threshold in pixels per second for adaptive smooth time calculation
 */
const ZOOM_VELOCITY_THRESHOLD = 800;

// ========================================
// Motion Blur Constants
// ========================================

/**
 * Minimum velocity speed threshold to apply motion blur
 */
const MOTION_BLUR_MIN_VELOCITY = 10;

/**
 * Maximum blur sigma value for cursor motion blur
 */
const MOTION_BLUR_MAX_SIGMA = 2;

/**
 * Motion blur strength multiplier
 */
const MOTION_BLUR_STRENGTH_MULTIPLIER = 0.1;

/**
 * Motion blur base multiplier for blur length calculation
 */
export const MOTION_BLUR_BASE_MULTIPLIER = 1.5;

/**
 * Maximum motion blur length in pixels
 */
export const MOTION_BLUR_MAX_LENGTH = 50;

/**
 * Minimum motion blur length to be noticeable (in pixels)
 */
export const MOTION_BLUR_MIN_LENGTH = 0.5;

/**
 * Motion blur sigma conversion factor (blur length to sigma)
 */
const MOTION_BLUR_SIGMA_FACTOR = 0.1;

/**
 * Minimum velocity threshold for motion blur (very small movements ignored)
 */
export const MOTION_BLUR_VELOCITY_THRESHOLD = 0.1;

// ========================================
// Image Processing Constants
// ========================================

/**
 * Black background color for letterboxing/pillarboxing
 */
export const BLACK_BACKGROUND = { r: 0, g: 0, b: 0, alpha: 1 };

/**
 * Transparent background color
 */
export const TRANSPARENT_BACKGROUND = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * PNG quality for frame output
 */
export const PNG_QUALITY = 80;

/**
 * PNG compression level (0-9, lower = faster but larger files)
 * Using 1 for speed since these are temporary files
 */
export const PNG_COMPRESSION_LEVEL = 1;

/**
 * SVG density for conversion to PNG (DPI)
 */
export const SVG_DENSITY = 300;

// ========================================
// Video Processing Progress Percentages
// ========================================

export const PROGRESS_ANALYZING_VIDEO = 5;
export const PROGRESS_EXTRACTING_FRAMES = 10;
export const PROGRESS_PREPARING_CURSOR = 15;
export const PROGRESS_PROCESSING_MOUSE_DATA = 20;
export const PROGRESS_RENDERING_START = 25;
export const PROGRESS_RENDERING_RANGE = 60; // 25% to 85% (25 + 60)
export const PROGRESS_ENCODING_VIDEO = 90;
export const PROGRESS_COMPLETE = 100;

// ========================================
// Click Detection Constants
// ========================================

/**
 * Cache duration for mouse button states (milliseconds)
 */
const CLICK_DETECTION_CACHE_DURATION_MS = 5;

/**
 * Timeout for click detection binary execution (milliseconds)
 */
const CLICK_DETECTION_TIMEOUT_MS = 50;

/**
 * Click threshold for fallback click detection (milliseconds)
 */
const CLICK_DETECTION_THRESHOLD_MS = 200;

// ========================================
// Click Circle Constants
// ========================================

/**
 * Default click circle radius in pixels
 */
export const CLICK_CIRCLE_DEFAULT_SIZE = 40;

/**
 * Default click circle color
 */
export const CLICK_CIRCLE_DEFAULT_COLOR = '#ffffff';

/**
 * Default click circle animation duration in milliseconds
 */
export const CLICK_CIRCLE_DEFAULT_DURATION = 400;

/**
 * Default mouse effects configuration
 */
export const DEFAULT_EFFECTS = {
  clickCircles: {
    enabled: false,
    size: CLICK_CIRCLE_DEFAULT_SIZE,
    color: CLICK_CIRCLE_DEFAULT_COLOR,
    duration: CLICK_CIRCLE_DEFAULT_DURATION,
  },
  trail: { enabled: false, length: 5, fadeSpeed: 0.5, color: '#ffffff' },
  highlightRing: { enabled: false, size: 30, color: '#ffffff', pulseSpeed: 0.5 },
} as const satisfies import('../types').MouseEffectsConfig;

// ========================================
// Mouse Effects Constants
// ========================================

/**
 * Default time difference for velocity calculation (milliseconds)
 */
const DEFAULT_TIME_DIFF_MS = 16;

/**
 * Speed threshold for adaptive smoothing
 */
const ADAPTIVE_SMOOTHING_SPEED_THRESHOLD = 10;

/**
 * Adaptive smoothing factor reduction (0-1)
 */
const ADAPTIVE_SMOOTHING_FACTOR = 0.5;

/**
 * Duplicate position threshold in pixels
 */
const DUPLICATE_POSITION_THRESHOLD = 1;

// ========================================
// Smooth Motion Constants
// ========================================

/**
 * Default velocity threshold for adaptive smooth time (pixels per second)
 */
export const DEFAULT_VELOCITY_THRESHOLD = 500;

/**
 * Default minimum smooth time for adaptive smoothing
 */
export const DEFAULT_MIN_SMOOTH_TIME = 0.05;

/**
 * SmoothDamp algorithm coefficients
 */
export const SMOOTHDAMP_COEFFICIENT_1 = 0.48;
export const SMOOTHDAMP_COEFFICIENT_2 = 0.235;

/**
 * Threshold for considering position/velocity as converged
 */
export const SMOOTHDAMP_CONVERGENCE_THRESHOLD = 0.0001;

// ========================================
// UI/Renderer Constants
// ========================================

/**
 * Maximum log entries to prevent memory issues
 */
const MAX_LOG_ENTRIES = 500;

/**
 * Timeline pixels per second for rendering
 */
const TIMELINE_PIXELS_PER_SECOND = 100;

/**
 * Keyframe detection tolerance in milliseconds
 */
const KEYFRAME_DETECTION_TOLERANCE_MS = 100;

/**
 * Canvas line width for drawing overlays
 */
const CANVAS_LINE_WIDTH = 2;

/**
 * Timeout for UI operations (milliseconds)
 */
const UI_TIMEOUT_SHORT_MS = 100;
const UI_TIMEOUT_MEDIUM_MS = 1000;
const UI_TIMEOUT_LONG_MS = 2000;
const UI_TIMEOUT_VERY_LONG_MS = 10000;

/**
 * Timeline tick intervals based on duration (milliseconds)
 */
const TIMELINE_TICK_INTERVAL_SHORT = 1000; // 1 second
const TIMELINE_TICK_INTERVAL_MEDIUM = 5000; // 5 seconds
const TIMELINE_TICK_INTERVAL_LONG = 10000; // 10 seconds

/**
 * Timeline duration thresholds for tick interval selection (milliseconds)
 */
const TIMELINE_DURATION_THRESHOLD_SHORT = 10000;
const TIMELINE_DURATION_THRESHOLD_MEDIUM = 60000;
const TIMELINE_DURATION_THRESHOLD_LONG = 300000;

