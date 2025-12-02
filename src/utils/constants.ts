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

/**
 * Batch size for processing frames in parallel
 */
export const FRAME_BATCH_SIZE = 10;

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
export const DEFAULT_CURSOR_SIZE = 60;

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
 * Number of frames before a click to start gliding cursor towards click position
 */
export const CURSOR_GLIDE_START_FRAMES = 16;

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
 * Default cursor frame offset (negative = earlier, positive = later)
 * Default is -10 frames (cursor arrives 10 frames earlier)
 */
export const DEFAULT_CURSOR_FRAME_OFFSET = -10;

/**
 * Cursor click animation duration in milliseconds
 */
export const CURSOR_CLICK_ANIMATION_DURATION_MS = 200;

/**
 * Cursor click animation scale down amount (0-1)
 * 0.8 means cursor scales to 80% of original size
 */
export const CURSOR_CLICK_ANIMATION_SCALE = 0.8;

// ========================================
// Zoom Configuration Constants
// ========================================

/**
 * Default dead zone radius for zoom (prevents micro-movements)
 */
export const DEFAULT_ZOOM_DEAD_ZONE = 15;

/**
 * Focus required duration in milliseconds before zoom activates
 */
export const ZOOM_FOCUS_REQUIRED_MS = 2000;

/**
 * Max movement in logical pixels to be considered "focused"
 */
export const ZOOM_FOCUS_THRESHOLD = 80;

/**
 * Must stay within this radius to maintain focus
 */
export const ZOOM_FOCUS_AREA_RADIUS = 150;

/**
 * Zoom transition speed (how fast to transition zoom in/out)
 * Lower values = slower, smoother transitions
 */
export const ZOOM_TRANSITION_SPEED = 0.03;

/**
 * Zoom out speed multiplier (zoom out faster than zoom in)
 */
export const ZOOM_OUT_SPEED_MULTIPLIER = 3;

/**
 * Velocity threshold in pixels per second for adaptive smooth time calculation
 */
export const ZOOM_VELOCITY_THRESHOLD = 800;

// ========================================
// Motion Blur Constants
// ========================================

/**
 * Minimum velocity speed threshold to apply motion blur
 */
export const MOTION_BLUR_MIN_VELOCITY = 10;

/**
 * Maximum blur sigma value for cursor motion blur
 */
export const MOTION_BLUR_MAX_SIGMA = 5;

/**
 * Motion blur strength multiplier
 */
export const MOTION_BLUR_STRENGTH_MULTIPLIER = 0.1;

/**
 * Motion blur base multiplier for blur length calculation
 */
export const MOTION_BLUR_BASE_MULTIPLIER = 20;

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
export const MOTION_BLUR_SIGMA_FACTOR = 0.3;

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
export const PNG_QUALITY = 90;

/**
 * PNG compression level
 */
export const PNG_COMPRESSION_LEVEL = 6;

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
export const CLICK_DETECTION_CACHE_DURATION_MS = 5;

/**
 * Timeout for click detection binary execution (milliseconds)
 */
export const CLICK_DETECTION_TIMEOUT_MS = 50;

/**
 * Click threshold for fallback click detection (milliseconds)
 */
export const CLICK_DETECTION_THRESHOLD_MS = 200;

// ========================================
// Mouse Effects Constants
// ========================================

/**
 * Default time difference for velocity calculation (milliseconds)
 */
export const DEFAULT_TIME_DIFF_MS = 16;

/**
 * Speed threshold for adaptive smoothing
 */
export const ADAPTIVE_SMOOTHING_SPEED_THRESHOLD = 10;

/**
 * Adaptive smoothing factor reduction (0-1)
 */
export const ADAPTIVE_SMOOTHING_FACTOR = 0.5;

/**
 * Duplicate position threshold in pixels
 */
export const DUPLICATE_POSITION_THRESHOLD = 1;

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
export const MAX_LOG_ENTRIES = 500;

/**
 * Timeline pixels per second for rendering
 */
export const TIMELINE_PIXELS_PER_SECOND = 100;

/**
 * Keyframe detection tolerance in milliseconds
 */
export const KEYFRAME_DETECTION_TOLERANCE_MS = 100;

/**
 * Canvas line width for drawing overlays
 */
export const CANVAS_LINE_WIDTH = 2;

/**
 * Timeout for UI operations (milliseconds)
 */
export const UI_TIMEOUT_SHORT_MS = 100;
export const UI_TIMEOUT_MEDIUM_MS = 1000;
export const UI_TIMEOUT_LONG_MS = 2000;
export const UI_TIMEOUT_VERY_LONG_MS = 10000;

/**
 * Timeline tick intervals based on duration (milliseconds)
 */
export const TIMELINE_TICK_INTERVAL_SHORT = 1000; // 1 second
export const TIMELINE_TICK_INTERVAL_MEDIUM = 5000; // 5 seconds
export const TIMELINE_TICK_INTERVAL_LONG = 10000; // 10 seconds

/**
 * Timeline duration thresholds for tick interval selection (milliseconds)
 */
export const TIMELINE_DURATION_THRESHOLD_SHORT = 10000;
export const TIMELINE_DURATION_THRESHOLD_MEDIUM = 60000;
export const TIMELINE_DURATION_THRESHOLD_LONG = 300000;

