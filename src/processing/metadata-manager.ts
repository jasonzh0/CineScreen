/**
 * MetadataManager - Centralized management of recording metadata
 * Handles loading, saving, and updating metadata including zoom state
 */

import type { RecordingMetadata } from '../types/metadata';
import type { ZoomSection } from './zoom-tracker';
import type { ZoomConfig, CursorConfig } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('MetadataManager');

/**
 * Zoom state structure for save/load operations
 */
export interface ZoomState {
  config: ZoomConfig;
  sections: ZoomSection[];
}

/**
 * Cursor state structure for save/load operations
 */
export interface CursorState {
  config: CursorConfig;
}

/**
 * MetadataManager class for handling recording metadata
 */
export class MetadataManager {
  private metadata: RecordingMetadata | null = null;
  private onChangeCallbacks: Array<(metadata: RecordingMetadata) => void> = [];

  constructor(metadata?: RecordingMetadata) {
    if (metadata) {
      this.metadata = metadata;
    }
  }

  /**
   * Set the current metadata
   */
  setMetadata(metadata: RecordingMetadata): void {
    this.metadata = metadata;
    this.notifyChange();
  }

  /**
   * Get the current metadata
   */
  getMetadata(): RecordingMetadata | null {
    return this.metadata;
  }

  /**
   * Check if metadata is loaded
   */
  hasMetadata(): boolean {
    return this.metadata !== null;
  }

  /**
   * Register a callback for metadata changes
   */
  onChange(callback: (metadata: RecordingMetadata) => void): void {
    this.onChangeCallbacks.push(callback);
  }

  /**
   * Remove a change callback
   */
  offChange(callback: (metadata: RecordingMetadata) => void): void {
    const index = this.onChangeCallbacks.indexOf(callback);
    if (index !== -1) {
      this.onChangeCallbacks.splice(index, 1);
    }
  }

  /**
   * Notify all listeners of metadata change
   */
  private notifyChange(): void {
    if (this.metadata) {
      for (const callback of this.onChangeCallbacks) {
        callback(this.metadata);
      }
    }
  }

  // ========================================
  // Zoom State Operations
  // ========================================

  /**
   * Get the current zoom state
   */
  getZoomState(): ZoomState | null {
    if (!this.metadata) return null;
    return {
      config: this.metadata.zoom.config,
      sections: this.metadata.zoom.sections,
    };
  }

  /**
   * Set the zoom state
   */
  setZoomState(state: ZoomState): void {
    if (!this.metadata) {
      logger.warn('Cannot set zoom state: no metadata loaded');
      return;
    }

    this.metadata.zoom.config = { ...this.metadata.zoom.config, ...state.config };
    this.metadata.zoom.sections = state.sections;
    this.notifyChange();
    logger.info('Zoom state updated');
  }

  /**
   * Get zoom sections
   */
  getZoomSections(): ZoomSection[] {
    return this.metadata?.zoom.sections || [];
  }

  /**
   * Set zoom sections
   */
  setZoomSections(sections: ZoomSection[]): void {
    if (!this.metadata) {
      logger.warn('Cannot set zoom sections: no metadata loaded');
      return;
    }

    this.metadata.zoom.sections = sections;
    this.notifyChange();
  }

  /**
   * Add a zoom section
   */
  addZoomSection(section: ZoomSection): void {
    if (!this.metadata) {
      logger.warn('Cannot add zoom section: no metadata loaded');
      return;
    }

    this.metadata.zoom.sections.push(section);
    this.notifyChange();
    logger.info(`Added zoom section: ${section.startTime}ms - ${section.endTime}ms`);
  }

  /**
   * Remove a zoom section by start time
   */
  removeZoomSection(startTime: number): void {
    if (!this.metadata) {
      logger.warn('Cannot remove zoom section: no metadata loaded');
      return;
    }

    const index = this.metadata.zoom.sections.findIndex(s => s.startTime === startTime);
    if (index !== -1) {
      this.metadata.zoom.sections.splice(index, 1);
      this.notifyChange();
      logger.info(`Removed zoom section at ${startTime}ms`);
    }
  }

  /**
   * Update a zoom section
   */
  updateZoomSection(startTime: number, updates: Partial<ZoomSection>): void {
    if (!this.metadata) {
      logger.warn('Cannot update zoom section: no metadata loaded');
      return;
    }

    const section = this.metadata.zoom.sections.find(s => s.startTime === startTime);
    if (section) {
      Object.assign(section, updates);
      this.notifyChange();
      logger.info(`Updated zoom section at ${startTime}ms`);
    }
  }

  /**
   * Get zoom config
   */
  getZoomConfig(): ZoomConfig | null {
    return this.metadata?.zoom.config || null;
  }

  /**
   * Update zoom config
   */
  updateZoomConfig(updates: Partial<ZoomConfig>): void {
    if (!this.metadata) {
      logger.warn('Cannot update zoom config: no metadata loaded');
      return;
    }

    this.metadata.zoom.config = { ...this.metadata.zoom.config, ...updates };
    this.notifyChange();
  }

  // ========================================
  // Cursor State Operations
  // ========================================

  /**
   * Get the current cursor state
   */
  getCursorState(): CursorState | null {
    if (!this.metadata) return null;
    return {
      config: this.metadata.cursor.config,
    };
  }

  /**
   * Get cursor config
   */
  getCursorConfig(): CursorConfig | null {
    return this.metadata?.cursor.config || null;
  }

  /**
   * Update cursor config
   */
  updateCursorConfig(updates: Partial<CursorConfig>): void {
    if (!this.metadata) {
      logger.warn('Cannot update cursor config: no metadata loaded');
      return;
    }

    this.metadata.cursor.config = { ...this.metadata.cursor.config, ...updates };
    this.notifyChange();
  }

  // ========================================
  // Video Info
  // ========================================

  /**
   * Get video dimensions
   */
  getVideoDimensions(): { width: number; height: number } | null {
    if (!this.metadata) return null;
    return {
      width: this.metadata.video.width,
      height: this.metadata.video.height,
    };
  }

  /**
   * Get video frame rate
   */
  getFrameRate(): number {
    return this.metadata?.video.frameRate || 30;
  }

  /**
   * Get recording duration in milliseconds
   */
  getDuration(): number {
    return this.metadata?.video.duration || 0;
  }

}

/**
 * Create a new MetadataManager instance
 */
export function createMetadataManager(metadata?: RecordingMetadata): MetadataManager {
  return new MetadataManager(metadata);
}
