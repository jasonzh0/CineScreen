import { exec } from 'child_process';
import { promisify } from 'util';
import { systemPreferences } from 'electron';
import type { PermissionStatus } from '../types';
import { createLogger } from '../utils/logger';

const execAsync = promisify(exec);
const logger = createLogger('Permissions');

// Platform detection
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

// macOS-only module (only loaded on macOS)
let macScreenCapture: {
  hasScreenCapturePermission: () => boolean;
  hasPromptedForPermission: () => boolean;
  openSystemPreferences: () => void;
} | null = null;

if (isMac) {
  try {
    macScreenCapture = require('mac-screen-capture-permissions');
  } catch (e) {
    logger.warn('mac-screen-capture-permissions not available');
  }
}

/**
 * Check if screen recording permission is granted
 * Uses mac-screen-capture-permissions on macOS, assumes granted on Windows
 */
export function checkScreenRecordingPermission(): boolean {
  if (isWindows) {
    // Windows doesn't require explicit screen recording permission
    return true;
  }

  if (isMac && macScreenCapture) {
    try {
      const granted = macScreenCapture.hasScreenCapturePermission();
      logger.info(`Screen recording permission: ${granted ? 'granted' : 'denied'}`);
      return granted;
    } catch (error) {
      logger.error('Failed to check screen recording permission:', error);
      return false;
    }
  }

  return true;
}

/**
 * Check if accessibility permission is granted
 * Uses Electron's native API on macOS, assumes granted on Windows
 */
export function checkAccessibilityPermission(): boolean {
  if (isWindows) {
    // Windows doesn't require explicit accessibility permission
    return true;
  }

  try {
    const granted = systemPreferences.isTrustedAccessibilityClient(false);
    logger.info(`Accessibility permission: ${granted ? 'granted' : 'denied'}`);
    return granted;
  } catch (error) {
    logger.error('Failed to check accessibility permission:', error);
    return false;
  }
}

/**
 * Check if microphone permission is granted
 * Uses Electron's native API for media access
 */
export function checkMicrophonePermission(): boolean {
  if (isWindows) {
    // On Windows, we can't easily check microphone permission status
    // Return true and let the actual recording handle any issues
    return true;
  }

  try {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    const granted = status === 'granted';
    logger.info(`Microphone permission: ${status}`);
    return granted;
  } catch (error) {
    logger.error('Failed to check microphone permission:', error);
    return false;
  }
}

/**
 * Request screen recording permission
 * Opens System Preferences on macOS, no-op on Windows
 */
export async function requestScreenRecordingPermission(): Promise<void> {
  if (isWindows) {
    logger.info('Screen recording permission not needed on Windows');
    return;
  }

  if (isMac && macScreenCapture) {
    logger.info('Opening System Preferences for Screen Recording...');
    macScreenCapture.openSystemPreferences();
  }
}

/**
 * Request accessibility permission
 * Opens System Preferences on macOS, no-op on Windows
 */
export async function requestAccessibilityPermission(): Promise<void> {
  if (isWindows) {
    logger.info('Accessibility permission not needed on Windows');
    return;
  }

  logger.info('Opening System Preferences for Accessibility...');
  // Prompt the system dialog
  systemPreferences.isTrustedAccessibilityClient(true);
  await execAsync(
    'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"'
  );
}

/**
 * Request microphone permission
 * Prompts the system dialog for microphone access on macOS
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  if (isWindows) {
    // Windows handles this differently; recording will prompt if needed
    logger.info('Microphone permission handled by OS on Windows');
    return true;
  }

  logger.info('Requesting microphone permission...');
  try {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    logger.info(`Microphone permission request result: ${granted ? 'granted' : 'denied'}`);
    return granted;
  } catch (error) {
    logger.error('Failed to request microphone permission:', error);
    return false;
  }
}

/**
 * Check all required permissions
 */
export function checkAllPermissions(): PermissionStatus {
  const screenRecording = checkScreenRecordingPermission();
  const accessibility = checkAccessibilityPermission();
  const microphone = checkMicrophonePermission();

  logger.info(`Permission status - Screen Recording: ${screenRecording}, Accessibility: ${accessibility}, Microphone: ${microphone}`);

  return {
    screenRecording,
    accessibility,
    microphone,
  };
}

/**
 * Request all missing permissions
 */
export async function requestMissingPermissions(): Promise<void> {
  const status = checkAllPermissions();

  if (!status.screenRecording) {
    await requestScreenRecordingPermission();
  }

  if (!status.accessibility) {
    await requestAccessibilityPermission();
  }

  if (!status.microphone) {
    await requestMicrophonePermission();
  }
}
