/**
 * Centralized logging utility
 * Supports both main process and renderer process
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

// Global log sender - will be set by main process
let sendLogToRenderer: ((message: string) => void) | null = null;

/**
 * Set the log sender function (called from main process)
 */
export function setLogSender(sender: (message: string) => void): void {
  sendLogToRenderer = sender;
}

// Check if we're in development mode
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

/**
 * Format log message
 */
function formatMessage(level: LogLevel, prefix: string, args: unknown[]): string {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  return `[${prefix}] ${message}`;
}

/**
 * Create a logger instance with a specific prefix
 */
export function createLogger(prefix: string): Logger {
  const log = (level: LogLevel, ...args: unknown[]) => {
    const logEntry = formatMessage(level, prefix, args);
    
    // Always log to console in development, or if it's an error/warn
    if (DEBUG || level === 'error' || level === 'warn') {
      switch (level) {
        case 'error':
          console.error(logEntry);
          break;
        case 'warn':
          console.warn(logEntry);
          break;
        case 'debug':
        case 'info':
        default:
          console.log(logEntry);
          break;
      }
    }
    
    // Send log to renderer if available
    if (sendLogToRenderer) {
      sendLogToRenderer(logEntry);
    }
  };

  return {
    debug: (...args: unknown[]) => log('debug', ...args),
    info: (...args: unknown[]) => log('info', ...args),
    warn: (...args: unknown[]) => log('warn', ...args),
    error: (...args: unknown[]) => log('error', ...args),
  };
}

/**
 * Default logger (no prefix)
 */
export const logger = createLogger('App');

