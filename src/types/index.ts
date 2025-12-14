export interface MouseEvent {
  timestamp: number;
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  action?: 'move' | 'down' | 'up';
  cursorType?: string; // System cursor type (arrow, pointer, hand, etc.)
}

export interface RecordingConfig {
  outputPath: string;
  frameRate?: number;
  quality?: 'low' | 'medium' | 'high';
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * All supported cursor shapes
 * These map to SVG assets in src/assets/ via cursor-renderer.ts
 */
export type CursorShape =
  | 'arrow'
  | 'pointer'
  | 'hand'
  | 'openhand'
  | 'closedhand'
  | 'crosshair'
  | 'ibeam'
  | 'ibeamvertical'
  | 'move'
  | 'resizeleft'
  | 'resizeright'
  | 'resizeleftright'
  | 'resizeup'
  | 'resizedown'
  | 'resizeupdown'
  | 'resize'
  | 'copy'
  | 'dragcopy'
  | 'draglink'
  | 'help'
  | 'notallowed'
  | 'contextmenu'
  | 'poof'
  | 'screenshot'
  | 'zoomin'
  | 'zoomout';

export interface CursorConfig {
  size: number;
  shape: CursorShape;
  motionBlur?: {
    enabled: boolean;
    strength: number; // 0-1
  };
  hideWhenStatic?: boolean; // Hide cursor when not moving
}

export interface RecordingState {
  isRecording: boolean;
  startTime?: number;
  outputPath?: string;
  tempVideoPath?: string;
  tempMouseDataPath?: string;
  metadataPath?: string; // Path to exported metadata JSON file
  mouseToVideoOffset?: number; // Offset in ms between mouse tracking start and video start
}

export interface PermissionStatus {
  screenRecording: boolean;
  accessibility: boolean;
  microphone: boolean;
}

export interface ZoomConfig {
  enabled: boolean;
  level: number; // 1.5-3.0
  transitionSpeed: number; // ms (legacy, use animationStyle instead)
  padding: number; // pixels around cursor
  followSpeed: number; // 0-1, how quickly zoom follows mouse (legacy)

  // Smoothness settings (Screen Studio-like)
  smoothness?: 'snappy' | 'smooth' | 'cinematic'; // Preset smoothness levels (legacy)
  animationStyle?: 'slow' | 'mellow' | 'quick' | 'rapid'; // Default: 'mellow'
  deadZone?: number; // Pixels - prevents jitter when cursor barely moves (default: 15)

  // Motion blur for zoom/panning
  motionBlur?: {
    enabled: boolean;
    strength: number; // 0-1
  };

  // Advanced physics controls (Screen Studio-like)
  physics?: {
    tension?: number; // Spring tension (default: 150)
    friction?: number; // Damping/friction (default: 22)
    mass?: number; // Mass/inertia (default: 1.2)
  };

  // Automatic zoom based on clicks/actions
  autoZoom?: boolean; // Automatically zoom on clicks (default: true)
}

export interface MouseEffectsConfig {
  clickCircles: {
    enabled: boolean;
    size: number;
    color: string;
    duration: number; // ms
  };
  trail: {
    enabled: boolean;
    length: number; // frames
    fadeSpeed: number; // 0-1
    color: string;
  };
  highlightRing: {
    enabled: boolean;
    size: number;
    color: string;
    pulseSpeed: number; // 0-1
  };
}

