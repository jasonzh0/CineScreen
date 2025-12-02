import type { RecordingMetadata, CursorKeyframe, ZoomKeyframe, ClickEvent } from '../../types/metadata';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Timeline');

export class Timeline {
  private container: HTMLElement;
  private ruler: HTMLElement;
  private track: HTMLElement;
  private playhead: HTMLElement;
  private metadata: RecordingMetadata | null = null;
  private duration: number = 0;
  private pixelsPerSecond: number = 100;
  private onSeek: ((time: number) => void) | null = null;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Timeline container not found: ${containerId}`);
    }
    this.container = container;

    // Find sub-elements
    this.ruler = container.querySelector('.timeline-ruler') as HTMLElement;
    this.track = container.querySelector('.timeline-track') as HTMLElement;
    this.playhead = container.querySelector('.playhead') as HTMLElement;

    if (!this.ruler || !this.track || !this.playhead) {
      throw new Error('Timeline sub-elements not found');
    }

    this.setupEventListeners();
  }

  setMetadata(metadata: RecordingMetadata, duration: number) {
    this.metadata = metadata;
    this.duration = duration;
    this.updateTimelineWidth();
    // Force a reflow to ensure width is applied
    void this.ruler.offsetWidth;
    void this.track.offsetWidth;
    this.render();
  }

  /**
   * Calculate and set the timeline width based on duration
   */
  private updateTimelineWidth() {
    if (!this.duration || this.duration <= 0) return;
    
    // Calculate timeline width: duration in seconds * pixels per second
    const durationSeconds = this.duration / 1000;
    const timelineWidth = durationSeconds * this.pixelsPerSecond;
    
    // Set width on ruler and track to make timeline scrollable
    // Remove 'right: 0' CSS that would override the width
    this.ruler.style.width = `${timelineWidth}px`;
    this.ruler.style.minWidth = `${timelineWidth}px`;
    this.ruler.style.maxWidth = `${timelineWidth}px`;
    this.ruler.style.right = 'auto';
    this.track.style.width = `${timelineWidth}px`;
    this.track.style.minWidth = `${timelineWidth}px`;
    this.track.style.maxWidth = `${timelineWidth}px`;
    this.track.style.right = 'auto';
  }

  /**
   * Get the actual timeline width (based on duration, not container width)
   */
  private getTimelineWidth(): number {
    if (!this.duration || this.duration <= 0) {
      return this.container.offsetWidth || 0;
    }
    const durationSeconds = this.duration / 1000;
    return durationSeconds * this.pixelsPerSecond;
  }

  setOnSeek(callback: (time: number) => void) {
    this.onSeek = callback;
  }

  updatePlayhead(time: number) {
    if (!this.duration) return;
    const position = time * this.pixelsPerSecond;
    this.playhead.style.left = `${position}px`;
  }

  private setupEventListeners() {
    let isDragging = false;

    this.container.addEventListener('mousedown', (e) => {
      isDragging = true;
      this.handleSeek(e);
    });

    this.container.addEventListener('mousemove', (e) => {
      if (isDragging) {
        this.handleSeek(e);
      }
    });

    this.container.addEventListener('mouseup', () => {
      isDragging = false;
    });

    this.container.addEventListener('mouseleave', () => {
      isDragging = false;
    });

    this.container.addEventListener('click', (e) => {
      this.handleSeek(e);
    });
  }

  private handleSeek(e: MouseEvent) {
    if (!this.duration || this.duration <= 0) return;
    
    const rect = this.container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const scrollLeft = this.container.scrollLeft;
    let x = mouseX + scrollLeft;
    
    // Clamp x to the actual timeline width to prevent seeking beyond the video duration
    const timelineWidth = this.getTimelineWidth();
    x = Math.max(0, Math.min(x, timelineWidth));
    
    // Calculate time: position (px) / pixelsPerSecond = time in seconds
    const timeSeconds = x / this.pixelsPerSecond;
    const durationSeconds = this.duration / 1000;
    const clampedTime = Math.max(0, Math.min(timeSeconds, durationSeconds));
    
    if (this.onSeek) {
      this.onSeek(clampedTime);
    }
  }

  private render() {
    if (!this.metadata || !this.duration) return;

    this.updateTimelineWidth();
    
    if (this.container.offsetWidth === 0) {
      setTimeout(() => this.render(), 100);
      return;
    }
    
    const timelineWidth = this.getTimelineWidth();
    if (timelineWidth === 0) {
      setTimeout(() => this.render(), 100);
      return;
    }

    // Clear existing markers
    const existingMarkers = this.track.querySelectorAll('.keyframe-marker');
    existingMarkers.forEach(marker => marker.remove());

    // Render cursor keyframes
    this.metadata.cursor.keyframes.forEach(keyframe => {
      this.createKeyframeMarker(keyframe.timestamp, 'cursor', keyframe);
    });

    // Render zoom keyframes
    this.metadata.zoom.keyframes.forEach(keyframe => {
      this.createKeyframeMarker(keyframe.timestamp, 'zoom', keyframe);
    });

    // Render click events
    this.metadata.clicks.forEach(click => {
      this.createKeyframeMarker(click.timestamp, 'click', click);
    });

    // Render ruler
    this.renderRuler();
  }

  private createKeyframeMarker(timestamp: number, type: 'cursor' | 'zoom' | 'click', data: any) {
    if (!this.duration || this.duration === 0) return;
    
    const clampedTimestamp = Math.max(0, Math.min(timestamp, this.duration));
    const timeSeconds = clampedTimestamp / 1000;
    const position = timeSeconds * this.pixelsPerSecond;
    
    const marker = document.createElement('div');
    marker.className = `keyframe-marker ${type}`;
    marker.style.left = `${position}px`;
    marker.title = `${type} at ${this.formatTime(clampedTimestamp / 1000)}`;
    marker.dataset.timestamp = clampedTimestamp.toString();
    marker.dataset.type = type;
    
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      const time = clampedTimestamp / 1000;
      if (this.onSeek) {
        this.onSeek(time);
      }
    });

    this.track.appendChild(marker);
  }

  private renderRuler() {
    if (!this.ruler || !this.duration) return;

    // Clear existing ruler marks
    const existingMarks = this.ruler.querySelectorAll('.ruler-mark');
    existingMarks.forEach(mark => mark.remove());

    const timelineWidth = this.getTimelineWidth();
    const interval = this.calculateRulerInterval();
    const marks: number[] = [];

    for (let time = 0; time <= this.duration; time += interval) {
      marks.push(time);
    }

    marks.forEach(time => {
      const timeSeconds = time / 1000;
      const position = timeSeconds * this.pixelsPerSecond;
      
      const mark = document.createElement('div');
      mark.className = 'ruler-mark';
      mark.style.position = 'absolute';
      mark.style.left = `${position}px`;
      mark.style.top = '0';
      mark.style.width = '1px';
      mark.style.height = '30px';
      mark.style.background = '#666';
      
      const label = document.createElement('div');
      label.textContent = this.formatTime(timeSeconds);
      label.style.position = 'absolute';
      label.style.left = '4px';
      label.style.top = '2px';
      label.style.fontSize = '10px';
      label.style.color = '#999';
      mark.appendChild(label);

      this.ruler.appendChild(mark);
    });
  }

  private calculateRulerInterval(): number {
    // Return interval in milliseconds
    if (this.duration < 10000) return 1000;
    if (this.duration < 60000) return 5000;
    if (this.duration < 300000) return 10000;
    return 30000;
  }

  private formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) {
      return '00:00';
    }
    
    const totalSeconds = Math.floor(seconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

