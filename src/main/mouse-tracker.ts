import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { MouseEvent } from '../types';

const execAsync = promisify(exec);

export class MouseTracker {
  private isTracking = false;
  private events: MouseEvent[] = [];
  private startTime: number = 0;
  private trackingInterval?: NodeJS.Timeout;
  private lastPosition = { x: 0, y: 0 };

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
      console.error('Error getting mouse position:', error);
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

      // Only record if position changed
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

