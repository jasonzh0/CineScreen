import { exec } from 'child_process';
import { promisify } from 'util';
import { systemPreferences } from 'electron';
import {
  hasScreenCapturePermission,
  hasPromptedForPermission,
  openSystemPreferences
} from 'mac-screen-capture-permissions';
import type { PermissionStatus } from '../types';
import { createLogger } from '../utils/logger';

const execAsync = promisify(exec);
const logger = createLogger('Permissions');

/**
 * Check if screen recording permission is granted
 * Uses mac-screen-capture-permissions for reliable detection
 */
export function checkScreenRecordingPermission(): boolean {
  try {
    const granted = hasScreenCapturePermission();
    logger.info(`Screen recording permission: ${granted ? 'granted' : 'denied'}`);
    return granted;
  } catch (error) {
    logger.error('Failed to check screen recording permission:', error);
    return false;
  }
}

/**
 * Check if accessibility permission is granted
 * Uses Electron's native API
 */
export function checkAccessibilityPermission(): boolean {
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
 * Opens System Preferences to the Screen Recording pane
 */
export async function requestScreenRecordingPermission(): Promise<void> {
  logger.info('Opening System Preferences for Screen Recording...');
  openSystemPreferences();
}

/**
 * Request accessibility permission
 * Opens System Preferences to the Accessibility pane
 */
export async function requestAccessibilityPermission(): Promise<void> {
  logger.info('Opening System Preferences for Accessibility...');
  // Prompt the system dialog
  systemPreferences.isTrustedAccessibilityClient(true);
  await execAsync(
    'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"'
  );
}

/**
 * Request microphone permission
 * Prompts the system dialog for microphone access
 */
export async function requestMicrophonePermission(): Promise<boolean> {
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
