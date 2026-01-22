/**
 * macOS Platform Implementation
 * Exports the complete platform interface for macOS
 */

import type { Platform } from '../types';
import { cursorControl } from './cursor-control';
import { telemetry } from './telemetry';
import { permissions } from './permissions';

const platform: Platform = {
  cursor: cursorControl,
  telemetry,
  permissions,
};

export default platform;
