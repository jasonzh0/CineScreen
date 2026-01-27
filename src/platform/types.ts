/**
 * Platform abstraction layer types
 * Defines interfaces for platform-specific functionality
 */

/**
 * Mouse telemetry data structure
 */
export interface MouseTelemetryData {
  cursor: string;
  buttons: {
    left: boolean;
    right: boolean;
    middle: boolean;
  };
  position: {
    x: number;
    y: number;
  };
}

/**
 * Cursor control interface
 * Handles showing/hiding the system cursor during recording
 */
export interface CursorControl {
  /**
   * Hide the system cursor
   * May call underlying APIs multiple times to handle reference counting
   */
  hide(): Promise<void>;

  /**
   * Show the system cursor
   */
  show(): Promise<void>;

  /**
   * Ensure cursor is visible (call on app close/recording end)
   * More aggressive than show() - handles edge cases like crashes
   */
  ensureVisible(): Promise<void>;
}

/**
 * Telemetry interface
 * Handles mouse position and button state tracking
 */
export interface Telemetry {
  /**
   * Start streaming telemetry data at high frequency
   */
  start(): void;

  /**
   * Stop streaming telemetry data
   */
  stop(): void;

  /**
   * Get the latest telemetry data
   * Returns cached data if streaming, otherwise performs single-shot query
   */
  getData(): Promise<MouseTelemetryData>;

  /**
   * Check if telemetry streaming is active
   */
  isActive(): boolean;
}

import type {
  DetailedPermissionStatus,
  PermissionRequestResult,
  SystemPreferencesPanel,
} from '../types';

/**
 * Permissions interface
 * Handles checking and requesting system permissions
 */
export interface Permissions {
  /**
   * Check if screen recording permission is granted
   */
  checkScreenRecording(): boolean;

  /**
   * Check if accessibility permission is granted
   */
  checkAccessibility(): boolean;

  /**
   * Check if microphone permission is granted
   */
  checkMicrophone(): boolean;

  /**
   * Request screen recording permission (opens system preferences on macOS)
   */
  requestScreenRecording(): Promise<void>;

  /**
   * Request accessibility permission (opens system preferences on macOS)
   */
  requestAccessibility(): Promise<void>;

  /**
   * Request microphone permission
   * @returns Whether permission was granted
   */
  requestMicrophone(): Promise<boolean>;

  /**
   * Check all permissions at once
   */
  checkAll(): {
    screenRecording: boolean;
    accessibility: boolean;
    microphone: boolean;
  };

  /**
   * Request all missing permissions
   */
  requestMissing(): Promise<void>;

  /**
   * Get detailed permission status for all permissions
   * Returns granular state (granted/denied/not-determined/restricted) and whether request is possible
   */
  getDetailedStatus(): DetailedPermissionStatus;

  /**
   * Request screen recording permission with detailed result
   * Returns action taken (dialog-shown, opened-preferences, already-granted, error)
   */
  requestScreenRecordingWithResult(): Promise<PermissionRequestResult>;

  /**
   * Request accessibility permission with detailed result
   * Returns action taken (dialog-shown, opened-preferences, already-granted, error)
   */
  requestAccessibilityWithResult(): Promise<PermissionRequestResult>;

  /**
   * Request microphone permission with detailed result
   * Returns action taken (dialog-shown, opened-preferences, already-granted, error)
   */
  requestMicrophoneWithResult(): Promise<PermissionRequestResult>;

  /**
   * Open System Preferences/Settings to a specific permission panel
   */
  openSystemPreferences(panel: SystemPreferencesPanel): Promise<void>;
}

/**
 * Platform interface
 * Main entry point for platform-specific functionality
 */
export interface Platform {
  cursor: CursorControl;
  telemetry: Telemetry;
  permissions: Permissions;
}
