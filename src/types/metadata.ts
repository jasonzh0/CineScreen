import type { CursorConfig, ZoomConfig, MouseEffectsConfig, MouseEvent } from './index';
import type { ZoomRegion } from '../processing/zoom-tracker';

/**
 * Easing curve types for interpolation
 */
export type EasingType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/**
 * Cursor keyframe - represents cursor state at a specific timestamp
 */
export interface CursorKeyframe {
  timestamp: number; // milliseconds from start
  x: number; // cursor X position
  y: number; // cursor Y position
  size?: number; // cursor size (optional, inherits from config if not set)
  shape?: CursorConfig['shape']; // cursor shape (optional, inherits from config if not set)
  color?: string; // cursor color (optional, inherits from config if not set)
  easing?: EasingType; // easing curve type for interpolation to next keyframe (default: 'easeInOut')
}

/**
 * Cursor segment - represents a segment between two cursor keyframes
 */
export interface CursorSegment {
  start: CursorKeyframe;
  end: CursorKeyframe;
  easing: EasingType; // easing curve type for this segment
}

/**
 * Zoom keyframe - represents zoom state at a specific timestamp
 */
export interface ZoomKeyframe {
  timestamp: number; // milliseconds from start
  centerX: number; // zoom center X position
  centerY: number; // zoom center Y position
  level: number; // zoom level (1.0 = no zoom, higher = more zoom)
  cropWidth?: number; // crop width (calculated from level if not set)
  cropHeight?: number; // crop height (calculated from level if not set)
  easing?: EasingType; // easing curve type for interpolation to next keyframe (default: 'easeInOut')
}

/**
 * Zoom segment - represents a segment between two zoom keyframes
 */
export interface ZoomSegment {
  start: ZoomKeyframe;
  end: ZoomKeyframe;
  easing: EasingType; // easing curve type for this segment
}

/**
 * Click event with full details
 */
export interface ClickEvent {
  timestamp: number; // milliseconds from start
  x: number; // click X position
  y: number; // click Y position
  button: 'left' | 'right' | 'middle';
  action: 'down' | 'up';
}

/**
 * Video information
 */
export interface VideoInfo {
  path: string; // path to video file
  width: number; // video width in pixels
  height: number; // video height in pixels
  frameRate: number; // frames per second
  duration: number; // duration in milliseconds
}

/**
 * Complete recording metadata
 * This is exported alongside the video file as JSON
 */
export interface RecordingMetadata {
  version: string; // metadata format version
  video: VideoInfo;
  cursor: {
    keyframes: CursorKeyframe[];
    segments?: CursorSegment[]; // optional: pre-computed segments for easier editing
    config: CursorConfig;
  };
  zoom: {
    keyframes: ZoomKeyframe[];
    segments?: ZoomSegment[]; // optional: pre-computed segments for easier editing
    config: ZoomConfig;
  };
  clicks: ClickEvent[];
  effects?: MouseEffectsConfig;
  createdAt: number; // timestamp when metadata was created
}

