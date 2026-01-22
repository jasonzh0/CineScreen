/**
 * Windows Mouse Telemetry
 * Uses koffi for direct Windows API calls
 */

import { createLogger } from '../../utils/logger';
import type { Telemetry, MouseTelemetryData } from '../types';

const logger = createLogger('WinTelemetry');

// Streaming mode state
let isStreaming = false;
let latestData: MouseTelemetryData | null = null;
let telemetryInterval: NodeJS.Timeout | null = null;

// Koffi state (initialized lazily)
let koffiInitialized = false;
let user32: any = null;
let GetCursorPos: any = null;
let GetAsyncKeyState: any = null;
let koffiPOINT: any = null;

// Virtual key codes for mouse buttons
const VK_LBUTTON = 0x01;
const VK_RBUTTON = 0x02;
const VK_MBUTTON = 0x04;

/**
 * Initialize koffi for Windows telemetry
 * This is called lazily on first use
 */
function initializeKoffi(): boolean {
  if (koffiInitialized) {
    return true;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');

    // Load User32.dll
    user32 = koffi.load('user32.dll');

    // Define POINT struct
    koffiPOINT = koffi.struct('POINT', {
      x: 'int32',
      y: 'int32'
    });

    // Define Windows API functions
    GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ POINT* lpPoint)');
    GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');

    koffiInitialized = true;
    logger.info('Koffi telemetry initialized successfully');
    return true;
  } catch (error) {
    logger.error('Failed to initialize koffi telemetry:', error);
    return false;
  }
}

/**
 * Check if a mouse button is pressed
 */
function isButtonPressed(vKey: number): boolean {
  if (!GetAsyncKeyState) return false;
  const state = GetAsyncKeyState(vKey);
  return (state & 0x8000) !== 0;
}

/**
 * Get mouse telemetry data directly via koffi
 */
function getTelemetryDirect(): MouseTelemetryData {
  const defaultData: MouseTelemetryData = {
    cursor: 'arrow',
    buttons: { left: false, right: false, middle: false },
    position: { x: 0, y: 0 }
  };

  if (!initializeKoffi()) {
    return defaultData;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');

    // Create buffer for POINT struct
    const pointBuffer = Buffer.alloc(koffi.sizeof(koffiPOINT));
    const success = GetCursorPos(pointBuffer);

    let x = 0, y = 0;
    if (success) {
      x = pointBuffer.readInt32LE(0);
      y = pointBuffer.readInt32LE(4);
    }

    return {
      cursor: 'arrow',
      buttons: {
        left: isButtonPressed(VK_LBUTTON),
        right: isButtonPressed(VK_RBUTTON),
        middle: isButtonPressed(VK_MBUTTON)
      },
      position: { x, y }
    };
  } catch (error) {
    logger.error('Error getting telemetry:', error);
    return defaultData;
  }
}

/**
 * Windows telemetry implementation
 */
export const telemetry: Telemetry = {
  start(): void {
    if (isStreaming) {
      logger.debug('Already streaming');
      return;
    }

    logger.info('Starting telemetry stream');

    if (!initializeKoffi()) {
      logger.error('Failed to initialize Windows telemetry');
      return;
    }

    isStreaming = true;

    // Poll at high frequency
    telemetryInterval = setInterval(() => {
      try {
        latestData = getTelemetryDirect();
      } catch (error) {
        logger.error('Error getting telemetry:', error);
      }
    }, 4); // 4ms = 250Hz

    logger.info('Windows telemetry streaming started via koffi');
  },

  stop(): void {
    if (!isStreaming) {
      return;
    }

    logger.info('Stopping telemetry stream');
    isStreaming = false;

    if (telemetryInterval) {
      clearInterval(telemetryInterval);
      telemetryInterval = null;
    }

    latestData = null;
  },

  async getData(): Promise<MouseTelemetryData> {
    // If streaming, return latest data immediately
    if (isStreaming && latestData) {
      return latestData;
    }

    // Single-shot mode
    return getTelemetryDirect();
  },

  isActive(): boolean {
    return isStreaming;
  },
};
