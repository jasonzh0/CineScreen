import type { RecordingMetadata, ZoomKeyframe, EasingType } from '../../types/metadata';

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

  addZoomKeyframe(timestamp: number, centerX: number, centerY: number, level: number) {
    if (!this.metadata) return;

    const videoWidth = this.metadata.video.width;
    const videoHeight = this.metadata.video.height;

    // Find if keyframe already exists at this timestamp (within 100ms tolerance)
    const tolerance = 100;
    const existingIndex = this.metadata.zoom.keyframes.findIndex(
      kf => Math.abs(kf.timestamp - timestamp) < tolerance
    );

    if (existingIndex >= 0) {
      // Update existing keyframe
      this.metadata.zoom.keyframes[existingIndex] = {
        ...this.metadata.zoom.keyframes[existingIndex],
        timestamp,
        centerX,
        centerY,
        level,
        cropWidth: videoWidth / level,
        cropHeight: videoHeight / level,
      };
    } else {
      // Add new keyframe
      const newKeyframe: ZoomKeyframe = {
        timestamp,
        centerX,
        centerY,
        level,
        cropWidth: videoWidth / level,
        cropHeight: videoHeight / level,
      };
      this.metadata.zoom.keyframes.push(newKeyframe);
      
      // Sort by timestamp
      this.metadata.zoom.keyframes.sort((a, b) => a.timestamp - b.timestamp);
    }

    // Notify update
    if (this.onMetadataUpdate) {
      this.onMetadataUpdate(this.metadata);
    }
  }

  removeZoomKeyframe(timestamp: number) {
    if (!this.metadata) return;

    const tolerance = 100;
    this.metadata.zoom.keyframes = this.metadata.zoom.keyframes.filter(
      kf => Math.abs(kf.timestamp - timestamp) >= tolerance
    );

    // Notify update
    if (this.onMetadataUpdate) {
      this.onMetadataUpdate(this.metadata);
    }
  }

  updateZoomKeyframe(timestamp: number, updates: Partial<ZoomKeyframe>) {
    if (!this.metadata) return;

    const tolerance = 100;
    const index = this.metadata.zoom.keyframes.findIndex(
      kf => Math.abs(kf.timestamp - timestamp) < tolerance
    );

    if (index >= 0) {
      this.metadata.zoom.keyframes[index] = {
        ...this.metadata.zoom.keyframes[index],
        ...updates,
      };

      // Re-sort if timestamp changed
      if (updates.timestamp !== undefined) {
        this.metadata.zoom.keyframes.sort((a, b) => a.timestamp - b.timestamp);
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

  getZoomKeyframes(): ZoomKeyframe[] {
    return this.metadata?.zoom.keyframes || [];
  }
}

