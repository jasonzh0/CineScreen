import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../utils/logger';

const execAsync = promisify(exec);
const logger = createLogger('CursorVisibility');

/**
 * Hide the system cursor on macOS
 * Uses AppleScript to call Objective-C bridge
 */
export async function hideSystemCursor(): Promise<void> {
  try {
    // Use AppleScript to hide cursor via Objective-C bridge
    // CGDisplayHideCursor is the macOS API to hide the cursor
    const script = `
      use framework "CoreGraphics"
      current application's CGDisplayHideCursor(current application's CGMainDisplayID())
    `;
    
    await execAsync(`osascript -l AppleScript -e '${script}'`);
    logger.info('System cursor hidden');
  } catch (error) {
    logger.warn('Failed to hide system cursor (may not be supported):', error);
    // Fallback: Try alternative method
    try {
      await execAsync(`osascript -e 'tell application "System Events" to set visible of process "Cursor" to false'`);
    } catch {
      // Ignore fallback errors
    }
  }
}

/**
 * Show the system cursor on macOS
 */
export async function showSystemCursor(): Promise<void> {
  try {
    // Use AppleScript to show cursor via Objective-C bridge
    const script = `
      use framework "CoreGraphics"
      current application's CGDisplayShowCursor(current application's CGMainDisplayID())
    `;
    
    await execAsync(`osascript -l AppleScript -e '${script}'`);
    logger.info('System cursor shown');
  } catch (error) {
    logger.warn('Failed to show system cursor:', error);
    // Fallback: Try to restore cursor
    try {
      // Move mouse slightly to force cursor redraw
      await execAsync(`osascript -e 'tell application "System Events" to key code 60'`); // Shift key
    } catch {
      // Ignore fallback errors
    }
  }
}

/**
 * Ensure cursor is visible (call this when app closes or recording ends)
 */
export async function ensureCursorVisible(): Promise<void> {
  // Call show multiple times to ensure cursor is visible
  // (CGDisplayHideCursor uses a reference count)
  for (let i = 0; i < 5; i++) {
    await showSystemCursor();
  }
}



