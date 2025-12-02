import { exec } from 'child_process';
import { promisify } from 'util';
import type { PermissionStatus } from '../types';

const execAsync = promisify(exec);

/**
 * Check if screen recording permission is granted
 */
export async function checkScreenRecordingPermission(): Promise<boolean> {
  try {
    // On macOS, we can check by trying to list screen capture devices
    // If permission is not granted, this will fail
    const { stdout } = await execAsync(
      'system_profiler SPAudioDataType 2>&1 || echo "permission_denied"'
    );
    // More reliable: check via AppleScript or direct API
    // For now, we'll use a simpler approach - try to get screen info
    const result = await execAsync(
      'osascript -e "tell application \\"System Events\\" to get name of every process" 2>&1'
    );
    return !result.stdout.includes('not allowed');
  } catch (error) {
    return false;
  }
}

/**
 * Check if accessibility permission is granted
 */
export async function checkAccessibilityPermission(): Promise<boolean> {
  try {
    // Check if we can access accessibility APIs
    const { stdout } = await execAsync(
      'osascript -e "tell application \\"System Events\\" to get name of every process" 2>&1'
    );
    return !stdout.includes('not allowed') && !stdout.includes('denied');
  } catch (error) {
    return false;
  }
}

/**
 * Request screen recording permission
 * Note: This will open System Preferences
 */
export async function requestScreenRecordingPermission(): Promise<void> {
  // Open System Preferences to Screen Recording
  await execAsync(
    'open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"'
  );
}

/**
 * Request accessibility permission
 * Note: This will open System Preferences
 */
export async function requestAccessibilityPermission(): Promise<void> {
  // Open System Preferences to Accessibility
  await execAsync(
    'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"'
  );
}

/**
 * Check all required permissions
 */
export async function checkAllPermissions(): Promise<PermissionStatus> {
  const [screenRecording, accessibility] = await Promise.all([
    checkScreenRecordingPermission(),
    checkAccessibilityPermission(),
  ]);

  return {
    screenRecording,
    accessibility,
  };
}

/**
 * Request all missing permissions
 */
export async function requestMissingPermissions(): Promise<void> {
  const status = await checkAllPermissions();

  if (!status.screenRecording) {
    await requestScreenRecordingPermission();
  }

  if (!status.accessibility) {
    await requestAccessibilityPermission();
  }
}

