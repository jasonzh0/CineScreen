import { writeFileSync, readFileSync } from 'fs';
import type { MouseEvent } from '../types';
import { getPlatform } from '../platform';
import type { Platform } from '../platform';
import { createLogger } from '../utils/logger';

const logger = createLogger('MouseTracker');

export class MouseTracker {
  private isTracking = false;
  private events: MouseEvent[] = [];
  private startTime: number = 0;
  private trackingInterval?: NodeJS.Timeout;
  private lastPosition = { x: 0, y: 0 };
  private lastButtonState = { left: false, right: false, middle: false };
  private lastCursorType: string = 'arrow';
  private platform: Platform | null = null;

  /**
   * Start tracking mouse movements
   */
  async startTracking(): Promise<void> {
    if (this.isTracking) {
      logger.warn('Tracking already in progress');
      return;
    }

    logger.info('=== Starting mouse tracking ===');
    this.isTracking = true;
    this.events = [];
    this.startTime = Date.now();

    // Initialize platform
    this.platform = await getPlatform();

    // Start streaming mode for high-frequency telemetry
    this.platform.telemetry.start();

    // Get initial telemetry data
    try {
      const initialTelemetry = await this.platform.telemetry.getData();
      this.lastPosition = initialTelemetry.position;
      this.lastButtonState = { ...initialTelemetry.buttons };
      this.lastCursorType = initialTelemetry.cursor;
      logger.info(`Initial mouse position: x=${this.lastPosition.x}, y=${this.lastPosition.y}`);
      logger.info(`Initial button states: left=${initialTelemetry.buttons.left}, right=${initialTelemetry.buttons.right}, middle=${initialTelemetry.buttons.middle}`);
      logger.info(`Initial cursor type: ${initialTelemetry.cursor}`);
    } catch (error) {
      logger.error('Failed to get initial telemetry:', error);
      this.lastButtonState = { left: false, right: false, middle: false };
    }

    // Track mouse position at high frequency (120Hz = ~8ms intervals)
    // Note: actual rate may be lower due to process spawn overhead
    const interval = 8; // milliseconds
    let iterationCount = 0;
    const logInterval = 100; // Log summary every 100 iterations (~1.6 seconds)

    logger.info(`Starting tracking interval: ${interval}ms (${1000 / interval}Hz)`);

    const loop = async () => {
      if (!this.isTracking || !this.platform) return;

      iterationCount++;
      try {
        // Single call to get all telemetry data
        const telemetry = await this.platform.telemetry.getData();
        const buttonStates = telemetry.buttons;
        const cursorType = telemetry.cursor;
        const position = telemetry.position;
        const timestamp = Date.now() - this.startTime;

        // Track cursor type changes
        if (cursorType !== this.lastCursorType) {
          logger.debug(`[CURSOR] Type changed from ${this.lastCursorType} to ${cursorType} at ${timestamp}ms`);
          this.lastCursorType = cursorType;
        }

        // Detect button state changes (clicks)
        if (buttonStates.left !== this.lastButtonState.left) {
          const event = {
            timestamp,
            x: position.x,
            y: position.y,
            button: 'left' as const,
            action: (buttonStates.left ? 'down' : 'up') as 'down' | 'up',
            cursorType,
          };
          this.events.push(event);
          this.lastButtonState.left = buttonStates.left;
        }
        if (buttonStates.right !== this.lastButtonState.right) {
          const event = {
            timestamp,
            x: position.x,
            y: position.y,
            button: 'right' as const,
            action: (buttonStates.right ? 'down' : 'up') as 'down' | 'up',
            cursorType,
          };
          this.events.push(event);
          logger.info(`[CLICK] Right button ${event.action} at (${position.x}, ${position.y}) at ${timestamp}ms - Total events: ${this.events.length}`);
          this.lastButtonState.right = buttonStates.right;
        }
        if (buttonStates.middle !== this.lastButtonState.middle) {
          const event = {
            timestamp,
            x: position.x,
            y: position.y,
            button: 'middle' as const,
            action: (buttonStates.middle ? 'down' : 'up') as 'down' | 'up',
            cursorType,
          };
          this.events.push(event);
          logger.info(`[CLICK] Middle button ${event.action} at (${position.x}, ${position.y}) at ${timestamp}ms - Total events: ${this.events.length}`);
          this.lastButtonState.middle = buttonStates.middle;
        }

        // Record position at every interval (even when stationary)
        // This ensures complete timeline data for smooth interpolation
        this.events.push({
          timestamp,
          x: position.x,
          y: position.y,
          action: 'move',
          cursorType,
        });
        this.lastPosition = position;
      } catch (error) {
        logger.error(`[ERROR] Error in tracking interval (iteration ${iterationCount}):`, error);
      }

      if (this.isTracking) {
        this.trackingInterval = setTimeout(loop, interval);
      }
    };

    loop();
  }

  /**
   * Stop tracking mouse movements
   */
  stopTracking(): void {
    if (!this.isTracking) {
      logger.warn('Stop tracking called but tracking was not active');
      return;
    }

    logger.info('=== Stopping mouse tracking ===');
    this.isTracking = false;
    if (this.trackingInterval) {
      clearTimeout(this.trackingInterval);
      this.trackingInterval = undefined;
    }

    // Stop streaming mode
    if (this.platform) {
      this.platform.telemetry.stop();
    }

    const clickEvents = this.events.filter(e => e.action === 'down' || e.action === 'up');
    const moveEvents = this.events.filter(e => e.action === 'move');
    const leftClicks = clickEvents.filter(e => e.button === 'left');
    const rightClicks = clickEvents.filter(e => e.button === 'right');
    const middleClicks = clickEvents.filter(e => e.button === 'middle');

    logger.info(`Tracking stopped. Summary:`);
    logger.info(`  Total events: ${this.events.length}`);
    logger.info(`  Click events: ${clickEvents.length} (left: ${leftClicks.length}, right: ${rightClicks.length}, middle: ${middleClicks.length})`);
    logger.info(`  Move events: ${moveEvents.length}`);
    logger.info(`  Tracking duration: ${Date.now() - this.startTime}ms`);

    if (clickEvents.length > 0) {
      logger.info(`  Click events details:`, clickEvents);
    } else {
      logger.warn(`  WARNING: No click events detected!`);
    }
  }

  /**
   * Get all tracked events
   */
  getEvents(): MouseEvent[] {
    const clickEvents = this.events.filter(e => e.action === 'down' || e.action === 'up');
    logger.debug(`[GET EVENTS] Returning ${this.events.length} total events (${clickEvents.length} clicks)`);
    return [...this.events];
  }

  /**
   * Save mouse events to JSON file
   */
  saveToFile(filePath: string): void {
    const clickEvents = this.events.filter(e => e.action === 'down' || e.action === 'up');
    const moveEvents = this.events.filter(e => e.action === 'move');

    logger.info(`[SAVE] Saving mouse events to file: ${filePath}`);
    logger.info(`[SAVE] Events summary: ${this.events.length} total (${clickEvents.length} clicks, ${moveEvents.length} moves)`);

    const data = {
      startTime: this.startTime,
      events: this.events,
    };

    try {
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      logger.info(`[SAVE] Successfully saved ${this.events.length} events to ${filePath}`);

      if (clickEvents.length === 0) {
        logger.warn(`[SAVE] WARNING: No click events in saved data!`);
      }
    } catch (error) {
      logger.error(`[SAVE] Failed to save events to file:`, error);
      throw error;
    }
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

