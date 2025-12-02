import type { RecordingMetadata, CursorKeyframe, EasingType } from '../../types/metadata';

export class CursorEditor {
  private metadata: RecordingMetadata | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private onMetadataUpdate: ((metadata: RecordingMetadata) => void) | null = null;
  private isEditing = false;

  constructor(videoElement: HTMLVideoElement) {
    this.videoElement = videoElement;
    this.setupEventListeners();
  }

  setMetadata(metadata: RecordingMetadata) {
    this.metadata = metadata;
  }

  setOnMetadataUpdate(callback: (metadata: RecordingMetadata) => void) {
    this.onMetadataUpdate = callback;
  }

  private setupEventListeners() {
    if (!this.videoElement) return;

    // Click on video to set cursor position
    this.videoElement.addEventListener('click', (e) => {
      if (!this.metadata || !this.videoElement) return;

      const rect = this.videoElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Convert display coordinates to video coordinates
      const videoWidth = this.metadata.video.width;
      const videoHeight = this.metadata.video.height;
      const displayWidth = rect.width;
      const displayHeight = rect.height;

      const videoX = (x / displayWidth) * videoWidth;
      const videoY = (y / displayHeight) * videoHeight;

      // Get current time
      const timestamp = this.videoElement.currentTime * 1000; // Convert to ms

      // Add or update cursor keyframe
      this.addCursorKeyframe(timestamp, videoX, videoY);
    });
  }

  addCursorKeyframe(timestamp: number, x: number, y: number) {
    if (!this.metadata) return;

    // Find if keyframe already exists at this timestamp (within 100ms tolerance)
    const tolerance = 100;
    const existingIndex = this.metadata.cursor.keyframes.findIndex(
      kf => Math.abs(kf.timestamp - timestamp) < tolerance
    );

    if (existingIndex >= 0) {
      // Update existing keyframe
      this.metadata.cursor.keyframes[existingIndex] = {
        ...this.metadata.cursor.keyframes[existingIndex],
        x,
        y,
        timestamp,
      };
    } else {
      // Add new keyframe
      const newKeyframe: CursorKeyframe = {
        timestamp,
        x,
        y,
      };
      this.metadata.cursor.keyframes.push(newKeyframe);
      
      // Sort by timestamp
      this.metadata.cursor.keyframes.sort((a, b) => a.timestamp - b.timestamp);
    }

    // Notify update
    if (this.onMetadataUpdate) {
      this.onMetadataUpdate(this.metadata);
    }
  }

  removeCursorKeyframe(timestamp: number) {
    if (!this.metadata) return;

    const tolerance = 100;
    this.metadata.cursor.keyframes = this.metadata.cursor.keyframes.filter(
      kf => Math.abs(kf.timestamp - timestamp) >= tolerance
    );

    // Notify update
    if (this.onMetadataUpdate) {
      this.onMetadataUpdate(this.metadata);
    }
  }

  updateCursorKeyframe(timestamp: number, updates: Partial<CursorKeyframe>) {
    if (!this.metadata) return;

    const tolerance = 100;
    const index = this.metadata.cursor.keyframes.findIndex(
      kf => Math.abs(kf.timestamp - timestamp) < tolerance
    );

    if (index >= 0) {
      this.metadata.cursor.keyframes[index] = {
        ...this.metadata.cursor.keyframes[index],
        ...updates,
      };

      // Re-sort if timestamp changed
      if (updates.timestamp !== undefined) {
        this.metadata.cursor.keyframes.sort((a, b) => a.timestamp - b.timestamp);
      }

      // Notify update
      if (this.onMetadataUpdate) {
        this.onMetadataUpdate(this.metadata);
      }
    }
  }

  getCursorKeyframes(): CursorKeyframe[] {
    return this.metadata?.cursor.keyframes || [];
  }
}

