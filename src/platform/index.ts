/**
 * Platform Factory
 * Provides platform-specific implementations with lazy loading
 */

import type { Platform, CursorControl, Telemetry, Permissions, MouseTelemetryData } from './types';

// Re-export types for convenience
export type { Platform, CursorControl, Telemetry, Permissions, MouseTelemetryData };

let platform: Platform | null = null;

/**
 * Get the platform-specific implementation
 * Lazy loads the appropriate module based on the current platform
 */
export async function getPlatform(): Promise<Platform> {
  if (platform) return platform;

  if (process.platform === 'darwin') {
    const mac = await import('./mac');
    platform = mac.default;
  } else if (process.platform === 'win32') {
    const win = await import('./win');
    platform = win.default;
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  return platform;
}

/**
 * Synchronously get the platform if already loaded
 * Returns null if not yet loaded
 */
export function getPlatformSync(): Platform | null {
  return platform;
}

/**
 * Check if the current platform is supported
 */
export function isPlatformSupported(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32';
}

/**
 * Get the current platform name
 */
export function getPlatformName(): 'mac' | 'win' | 'unsupported' {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'win';
  return 'unsupported';
}
