/**
 * Persistent user config storage
 * Reads/writes config.json in the platform-appropriate userData directory
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ConfigStore');

export interface UserConfig {
  // Recording
  outputDir: string | null;
  frameRate: string;

  // Cursor
  cursorSize: number;
  cursorShape: string;

  // Zoom
  zoomEnabled: boolean;
  zoomLevel: number;
  zoomAnimation: string;

  // Click effects
  clickCirclesEnabled: boolean;
  clickCircleColor: string;
}

const defaults: UserConfig = {
  outputDir: null,
  frameRate: '60',

  cursorSize: 32,
  cursorShape: 'arrow',

  zoomEnabled: true,
  zoomLevel: 2.0,
  zoomAnimation: 'mellow',

  clickCirclesEnabled: false,
  clickCircleColor: '#ffffff',
};

function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

export function loadConfig(): UserConfig {
  try {
    const raw = readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function saveConfig(config: UserConfig): void {
  try {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Failed to save config:', error);
  }
}

export function getConfigValue<K extends keyof UserConfig>(key: K): UserConfig[K] {
  return loadConfig()[key];
}

export function setConfigValue<K extends keyof UserConfig>(key: K, value: UserConfig[K]): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}
