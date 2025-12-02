import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { MouseEvent } from '../types';
import { getMouseButtonStates } from '../processing/click-detector';
import { createLogger } from '../utils/logger';

const logger = createLogger('MouseTracker');

const execAsync = promisify(exec);

export class MouseTracker {
  private isTracking = false;
  private events: MouseEvent[] = [];
  private startTime: number = 0;
  private trackingInterval?: NodeJS.Timeout;
  private lastPosition = { x: 0, y: 0 };
  private lastButtonState = { left: false, right: false, middle: false };

  /**
   * Get current mouse position using AppleScript
   */
  private async getMousePosition(): Promise<{ x: number; y: number }> {
    try {
      const script = `
        tell application "System Events"
          set mousePos to mouse location
          return (item 1 of mousePos) & "," & (item 2 of mousePos)
        end tell
      `;
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const [x, y] = stdout.trim().split(',').map(Number);
      return { x, y };
    } catch (error) {
      logger.error('Error getting mouse position:', error);
      return this.lastPosition;
    }
  }


  /**
   * Start tracking mouse movements
   */
  async startTracking(): Promise<void> {
    if (this.isTracking) {
      return;
    }

    this.isTracking = true;
    this.events = [];
    this.startTime = Date.now();

    // Track mouse position at high frequency (60Hz = ~16ms intervals)
    const interval = 16; // milliseconds

    this.trackingInterval = setInterval(async () => {
      const position = await this.getMousePosition();
      const timestamp = Date.now() - this.startTime;
      const buttonStates = await getMouseButtonStates();

      // Detect button state changes (clicks)
      if (buttonStates.left !== this.lastButtonState.left) {
        this.events.push({
          timestamp,
          x: position.x,
          y: position.y,
          button: 'left',
          action: buttonStates.left ? 'down' : 'up',
        });
        this.lastButtonState.left = buttonStates.left;
      }
      if (buttonStates.right !== this.lastButtonState.right) {
        this.events.push({
          timestamp,
          x: position.x,
          y: position.y,
          button: 'right',
          action: buttonStates.right ? 'down' : 'up',
        });
        this.lastButtonState.right = buttonStates.right;
      }
      if (buttonStates.middle !== this.lastButtonState.middle) {
        this.events.push({
          timestamp,
          x: position.x,
          y: position.y,
          button: 'middle',
          action: buttonStates.middle ? 'down' : 'up',
        });
        this.lastButtonState.middle = buttonStates.middle;
      }

      // Record position changes (moves)
      if (position.x !== this.lastPosition.x || position.y !== this.lastPosition.y) {
        this.events.push({
          timestamp,
          x: position.x,
          y: position.y,
          action: 'move',
        });
        this.lastPosition = position;
      }
    }, interval);
  }

  /**
   * Stop tracking mouse movements
   */
  stopTracking(): void {
    if (!this.isTracking) {
      return;
    }

    this.isTracking = false;
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = undefined;
    }
  }

  /**
   * Get all tracked events
   */
  getEvents(): MouseEvent[] {
    return [...this.events];
  }

  /**
   * Save mouse events to JSON file
   */
  saveToFile(filePath: string): void {
    const data = {
      startTime: this.startTime,
      events: this.events,
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load mouse events from JSON file
   */
  static loadFromFile(filePath: string): { startTime: number; events: MouseEvent[] } {
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  }

  /**
   * Clear all tracked events
   */
  clear(): void {
    this.events = [];
    this.startTime = 0;
  }
}

