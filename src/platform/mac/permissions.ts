/**
 * macOS Permissions
 * Handles checking and requesting system permissions on macOS
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { systemPreferences } from 'electron';
import { createLogger } from '../../utils/logger';
import type { Permissions } from '../types';

const execAsync = promisify(exec);
const logger = createLogger('MacPermissions');

// macOS-only module (only loaded on macOS)
let macScreenCapture: {
  hasScreenCapturePermission: () => boolean;
  hasPromptedForPermission: () => boolean;
  openSystemPreferences: () => void;
} | null = null;

try {
  macScreenCapture = require('mac-screen-capture-permissions');
} catch (e) {
  logger.warn('mac-screen-capture-permissions not available');
}

/**
 * macOS permissions implementation
 */
export const permissions: Permissions = {
  checkScreenRecording(): boolean {
    if (macScreenCapture) {
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
  },

  checkAccessibility(): boolean {
    try {
      const granted = systemPreferences.isTrustedAccessibilityClient(false);
      logger.info(`Accessibility permission: ${granted ? 'granted' : 'denied'}`);
      return granted;
    } catch (error) {
      logger.error('Failed to check accessibility permission:', error);
      return false;
    }
  },

  checkMicrophone(): boolean {
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      const granted = status === 'granted';
      logger.info(`Microphone permission: ${status}`);
      return granted;
    } catch (error) {
      logger.error('Failed to check microphone permission:', error);
      return false;
    }
  },

  async requestScreenRecording(): Promise<void> {
    if (macScreenCapture) {
      logger.info('Opening System Preferences for Screen Recording...');
      macScreenCapture.openSystemPreferences();
    }
  },

  async requestAccessibility(): Promise<void> {
    logger.info('Opening System Preferences for Accessibility...');
    // Prompt the system dialog
    systemPreferences.isTrustedAccessibilityClient(true);
    await execAsync(
      'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"'
    );
  },

  async requestMicrophone(): Promise<boolean> {
    logger.info('Requesting microphone permission...');
    try {
      // Check current status first
      const status = systemPreferences.getMediaAccessStatus('microphone');
      logger.info(`Current microphone permission status: ${status}`);

      if (status === 'granted') {
        return true;
      }

      if (status === 'not-determined') {
        // First time request - system dialog will appear
        const granted = await systemPreferences.askForMediaAccess('microphone');
        logger.info(`Microphone permission request result: ${granted ? 'granted' : 'denied'}`);
        return granted;
      }

      // Status is 'denied' or 'restricted' - must open System Preferences
      // askForMediaAccess won't show a dialog in this case
      logger.info('Microphone permission denied/restricted, opening System Preferences...');
      await execAsync(
        'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"'
      );
      return false;
    } catch (error) {
      logger.error('Failed to request microphone permission:', error);
      return false;
    }
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
    const status = this.checkAll();

    if (!status.screenRecording) {
      await this.requestScreenRecording();
    }

    if (!status.accessibility) {
      await this.requestAccessibility();
    }

    if (!status.microphone) {
      await this.requestMicrophone();
    }
  },
};
