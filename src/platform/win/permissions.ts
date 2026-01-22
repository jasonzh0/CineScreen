/**
 * Windows Permissions
 * Windows doesn't require explicit permissions like macOS,
 * so most methods return true or are no-ops
 */

import { createLogger } from '../../utils/logger';
import type { Permissions } from '../types';

const logger = createLogger('WinPermissions');

/**
 * Windows permissions implementation
 * Most permissions are implicitly granted on Windows
 */
export const permissions: Permissions = {
  checkScreenRecording(): boolean {
    // Windows doesn't require explicit screen recording permission
    return true;
  },

  checkAccessibility(): boolean {
    // Windows doesn't require explicit accessibility permission
    return true;
  },

  checkMicrophone(): boolean {
    // On Windows, we can't easily check microphone permission status
    // Return true and let the actual recording handle any issues
    return true;
  },

  async requestScreenRecording(): Promise<void> {
    logger.info('Screen recording permission not needed on Windows');
  },

  async requestAccessibility(): Promise<void> {
    logger.info('Accessibility permission not needed on Windows');
  },

  async requestMicrophone(): Promise<boolean> {
    // Windows handles this differently; recording will prompt if needed
    logger.info('Microphone permission handled by OS on Windows');
    return true;
  },

  checkAll(): { screenRecording: boolean; accessibility: boolean; microphone: boolean } {
    const screenRecording = this.checkScreenRecording();
    const accessibility = this.checkAccessibility();
    const microphone = this.checkMicrophone();

    logger.info(`Permission status - Screen Recording: ${screenRecording}, Accessibility: ${accessibility}, Microphone: ${microphone}`);

    return {
      screenRecording,
      accessibility,
      microphone,
    };
  },

  async requestMissing(): Promise<void> {
    // No-op on Windows - permissions are implicit
    logger.info('No permissions to request on Windows');
  },
};
