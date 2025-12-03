import type { RecordingMetadata } from '../../types/metadata';
import type { ZoomSection } from '../../processing/zoom-tracker';

export class ZoomEditor {
  private metadata: RecordingMetadata | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private onMetadataUpdate: ((metadata: RecordingMetadata) => void) | null = null;

  constructor(videoElement: HTMLVideoElement) {
    this.videoElement = videoElement;
  }

  setMetadata(metadata: RecordingMetadata) {
    this.metadata = metadata;
  }

  setOnMetadataUpdate(callback: (metadata: RecordingMetadata) => void) {
    this.onMetadataUpdate = callback;
  }

  addZoomSection(startTime: number, endTime: number, scale: number, centerX: number, centerY: number) {
    if (!this.metadata) return;

    const newSection: ZoomSection = {
      startTime,
      endTime,
      scale,
      centerX,
      centerY,
    };

    this.metadata.zoom.sections.push(newSection);

    // Sort by start time
    this.metadata.zoom.sections.sort((a, b) => a.startTime - b.startTime);

    // Notify update
    if (this.onMetadataUpdate) {
      this.onMetadataUpdate(this.metadata);
    }
  }

  removeZoomSection(startTime: number) {
    if (!this.metadata) return;

    const tolerance = 100; // 100ms tolerance
    this.metadata.zoom.sections = this.metadata.zoom.sections.filter(
      section => Math.abs(section.startTime - startTime) >= tolerance
    );

    // Notify update
    if (this.onMetadataUpdate) {
      this.onMetadataUpdate(this.metadata);
    }
  }

  updateZoomSection(startTime: number, updates: Partial<ZoomSection>) {
    if (!this.metadata) return;

    const tolerance = 100; // 100ms tolerance
    const index = this.metadata.zoom.sections.findIndex(
      section => Math.abs(section.startTime - startTime) < tolerance
    );

    if (index >= 0) {
      this.metadata.zoom.sections[index] = {
        ...this.metadata.zoom.sections[index],
        ...updates,
      };

      // Re-sort if start time changed
      if (updates.startTime !== undefined) {
        this.metadata.zoom.sections.sort((a, b) => a.startTime - b.startTime);
      }

      // Notify update
      if (this.onMetadataUpdate) {
        this.onMetadataUpdate(this.metadata);
      }
    }
  }

  setZoomLevel(level: number) {
    if (!this.metadata) return;
    this.metadata.zoom.config.level = level;

    if (this.onMetadataUpdate) {
      this.onMetadataUpdate(this.metadata);
    }
  }

  toggleZoom(enabled: boolean) {
    if (!this.metadata) return;
    this.metadata.zoom.config.enabled = enabled;

    if (this.onMetadataUpdate) {
      this.onMetadataUpdate(this.metadata);
    }
  }

  getZoomSections(): ZoomSection[] {
    return this.metadata?.zoom.sections || [];
  }
}

