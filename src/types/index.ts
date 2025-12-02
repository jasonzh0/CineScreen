export interface MouseEvent {
  timestamp: number;
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  action?: 'move' | 'down' | 'up';
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

export interface CursorConfig {
  size: number;
  shape: 'arrow' | 'pointer' | 'hand' | 'crosshair';
  smoothing: number; // 0-1, where 1 is maximum smoothing
  color?: string;
}

export interface RecordingState {
  isRecording: boolean;
  startTime?: number;
  outputPath?: string;
  tempVideoPath?: string;
  tempMouseDataPath?: string;
}

export interface PermissionStatus {
  screenRecording: boolean;
  accessibility: boolean;
}

