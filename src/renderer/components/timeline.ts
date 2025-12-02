import type { RecordingMetadata, CursorKeyframe, ZoomKeyframe, ClickEvent } from '../../types/metadata';

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
    this.render();
  }

  setOnSeek(callback: (time: number) => void) {
    this.onSeek = callback;
  }

  updatePlayhead(time: number) {
    if (!this.duration) return;
    // time is in seconds, duration is in milliseconds
    const timeMs = time * 1000;
    const position = (timeMs / this.duration) * this.container.offsetWidth;
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
      const rect = this.container.getBoundingClientRect();
      const x = e.clientX - rect.left;
    const timeMs = (x / this.container.offsetWidth) * this.duration;
    const timeSeconds = timeMs / 1000; // Convert to seconds
      if (this.onSeek && this.duration > 0) {
      this.onSeek(Math.max(0, Math.min(timeSeconds, this.duration / 1000)));
      }
  }

  private render() {
    if (!this.metadata || !this.duration) return;

    // Wait for container to have width before rendering
    if (this.container.offsetWidth === 0) {
      // Defer rendering until container has dimensions
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
    if (this.container.offsetWidth === 0) return; // Can't position if container has no width
    
    // Ensure timestamp is within valid range
    const clampedTimestamp = Math.max(0, Math.min(timestamp, this.duration));
    const position = (clampedTimestamp / this.duration) * this.container.offsetWidth;
    
    const marker = document.createElement('div');
    marker.className = `keyframe-marker ${type}`;
    marker.style.left = `${position}px`;
    marker.title = `${type} at ${this.formatTime(clampedTimestamp / 1000)}`;
    marker.dataset.timestamp = clampedTimestamp.toString();
    marker.dataset.type = type;
    
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      const time = timestamp / 1000; // Convert to seconds
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

    const width = this.container.offsetWidth;
    const interval = this.calculateRulerInterval();
    const marks: number[] = [];

    for (let time = 0; time <= this.duration; time += interval) {
      marks.push(time);
    }

    marks.forEach(time => {
      const position = (time / this.duration) * width;
      const mark = document.createElement('div');
      mark.className = 'ruler-mark';
      mark.style.position = 'absolute';
      mark.style.left = `${position}px`;
      mark.style.top = '0';
      mark.style.width = '1px';
      mark.style.height = '30px';
      mark.style.background = '#666';
      
      const label = document.createElement('div');
      label.textContent = this.formatTime(time / 1000);
      label.style.position = 'absolute';
      label.style.left = `${position + 2}px`;
      label.style.top = '2px';
      label.style.fontSize = '10px';
      label.style.color = '#999';
      mark.appendChild(label);

      this.ruler.appendChild(mark);
    });
  }

  private calculateRulerInterval(): number {
    // Calculate appropriate interval based on duration
    // Return interval in milliseconds
    if (this.duration < 10000) return 1000; // 1 second
    if (this.duration < 60000) return 5000; // 5 seconds
    if (this.duration < 300000) return 10000; // 10 seconds
    return 30000; // 30 seconds
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

