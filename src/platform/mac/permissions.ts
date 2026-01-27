/**
 * macOS Permissions
 * Handles checking and requesting system permissions on macOS
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { systemPreferences } from 'electron';
import { createLogger } from '../../utils/logger';
import type { Permissions } from '../types';
import type {
  PermissionState,
  DetailedPermissionStatus,
  PermissionRequestResult,
  SystemPreferencesPanel,
} from '../../types';

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
 * Get the raw microphone permission state (internal helper)
 */
function getMicrophoneState(): PermissionState {
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    // Map macOS status to our PermissionState
    switch (status) {
      case 'granted':
        return 'granted';
      case 'denied':
        return 'denied';
      case 'not-determined':
        return 'not-determined';
      case 'restricted':
        return 'restricted';
      default:
        return 'unavailable';
    }
  } catch (error) {
    logger.error('Failed to get microphone state:', error);
    return 'unavailable';
  }
}

/**
 * Get the raw screen recording permission state (internal helper)
 */
function getScreenRecordingState(): PermissionState {
  // Try native module first
  if (macScreenCapture) {
    try {
      const hasPermission = macScreenCapture.hasScreenCapturePermission();
      if (hasPermission) {
        return 'granted';
      }
      // macOS doesn't differentiate between denied and not-determined for screen recording
      // We can check if we've prompted before
      const hasPrompted = macScreenCapture.hasPromptedForPermission();
      return hasPrompted ? 'denied' : 'not-determined';
    } catch (error) {
      logger.error('Failed to get screen recording state via native module:', error);
    }
  }

  // Fallback: use Electron's built-in API
  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    logger.info(`Screen recording status via Electron API: ${status}`);
    switch (status) {
      case 'granted':
        return 'granted';
      case 'denied':
        return 'denied';
      case 'not-determined':
        return 'not-determined';
      case 'restricted':
        return 'restricted';
      default:
        return 'not-determined'; // Default to not-determined instead of unavailable
    }
  } catch (error) {
    logger.error('Failed to get screen recording state:', error);
    return 'not-determined'; // Default to not-determined so user can try to grant
  }
}

/**
 * Get the raw accessibility permission state (internal helper)
 */
function getAccessibilityState(): PermissionState {
  try {
    // Check without prompting
    const hasPermission = systemPreferences.isTrustedAccessibilityClient(false);
    if (hasPermission) {
      return 'granted';
    }
    // macOS doesn't provide a way to distinguish denied vs not-determined for accessibility
    // We'll assume not-determined if not granted (user can always check System Preferences)
    return 'not-determined';
  } catch (error) {
    logger.error('Failed to get accessibility state:', error);
    return 'unavailable';
  }
}

/**
 * macOS permissions implementation
 */
export const permissions: Permissions = {
  checkScreenRecording(): boolean {
    // Try native module first
    if (macScreenCapture) {
      try {
        const granted = macScreenCapture.hasScreenCapturePermission();
        logger.info(`Screen recording permission (native): ${granted ? 'granted' : 'denied'}`);
        return granted;
      } catch (error) {
        logger.error('Failed to check screen recording permission via native module:', error);
      }
    }

    // Fallback: use Electron's built-in API
    try {
      const status = systemPreferences.getMediaAccessStatus('screen');
      const granted = status === 'granted';
      logger.info(`Screen recording permission (Electron API): ${status}`);
      return granted;
    } catch (error) {
      logger.error('Failed to check screen recording permission:', error);
      return false;
    }
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

  getDetailedStatus(): DetailedPermissionStatus {
    const screenRecordingState = getScreenRecordingState();
    const accessibilityState = getAccessibilityState();
    const microphoneState = getMicrophoneState();

    return {
      screenRecording: {
        state: screenRecordingState,
        // Screen recording can only be granted via System Preferences
        canRequest: screenRecordingState === 'not-determined',
      },
      accessibility: {
        state: accessibilityState,
        // Accessibility can show a prompt via isTrustedAccessibilityClient(true)
        canRequest: accessibilityState === 'not-determined',
      },
      microphone: {
        state: microphoneState,
        // Microphone can show a system dialog if not-determined
        canRequest: microphoneState === 'not-determined',
      },
    };
  },

  async requestScreenRecordingWithResult(): Promise<PermissionRequestResult> {
    const currentState = getScreenRecordingState();

    if (currentState === 'granted') {
      return {
        success: true,
        newState: 'granted',
        action: 'already-granted',
      };
    }

    try {
      // Screen recording always requires opening System Preferences on macOS
      if (macScreenCapture) {
        logger.info('Opening System Preferences for Screen Recording...');
        macScreenCapture.openSystemPreferences();
      } else {
        await execAsync(
          'open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"'
        );
      }

      return {
        success: true,
        newState: currentState, // State won't change until user grants in System Preferences
        action: 'opened-preferences',
      };
    } catch (error) {
      logger.error('Failed to request screen recording permission:', error);
      return {
        success: false,
        newState: currentState,
        action: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  async requestAccessibilityWithResult(): Promise<PermissionRequestResult> {
    const currentState = getAccessibilityState();

    if (currentState === 'granted') {
      return {
        success: true,
        newState: 'granted',
        action: 'already-granted',
      };
    }

    try {
      // Try to show the system prompt first
      const result = systemPreferences.isTrustedAccessibilityClient(true);

      if (result) {
        return {
          success: true,
          newState: 'granted',
          action: 'dialog-shown',
        };
      }

      // Open System Preferences for manual granting
      logger.info('Opening System Preferences for Accessibility...');
      await execAsync(
        'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"'
      );

      return {
        success: true,
        newState: 'not-determined',
        action: 'opened-preferences',
      };
    } catch (error) {
      logger.error('Failed to request accessibility permission:', error);
      return {
        success: false,
        newState: currentState,
        action: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  async requestMicrophoneWithResult(): Promise<PermissionRequestResult> {
    const currentState = getMicrophoneState();
    logger.info(`Requesting microphone permission. Current state: ${currentState}`);

    if (currentState === 'granted') {
      return {
        success: true,
        newState: 'granted',
        action: 'already-granted',
      };
    }

    if (currentState === 'not-determined') {
      try {
        // First time request - system dialog will appear
        const granted = await systemPreferences.askForMediaAccess('microphone');
        const newState = granted ? 'granted' : 'denied';
        logger.info(`Microphone permission dialog result: ${newState}`);

        return {
          success: granted,
          newState,
          action: 'dialog-shown',
        };
      } catch (error) {
        logger.error('Failed to show microphone permission dialog:', error);
        return {
          success: false,
          newState: currentState,
          action: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    // Status is 'denied' or 'restricted' - must open System Preferences
    try {
      logger.info('Microphone permission denied/restricted, opening System Preferences...');
      await execAsync(
        'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"'
      );

      return {
        success: true,
        newState: currentState,
        action: 'opened-preferences',
      };
    } catch (error) {
      logger.error('Failed to open System Preferences for microphone:', error);
      return {
        success: false,
        newState: currentState,
        action: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  async openSystemPreferences(panel: SystemPreferencesPanel): Promise<void> {
    const panelUrls: Record<SystemPreferencesPanel, string> = {
      'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      'accessibility': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      'microphone': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    };

    const url = panelUrls[panel];
    logger.info(`Opening System Preferences panel: ${panel}`);

    try {
      await execAsync(`open "${url}"`);
    } catch (error) {
      logger.error(`Failed to open System Preferences panel ${panel}:`, error);
      throw error;
    }
  },
};
