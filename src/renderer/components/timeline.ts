import type { RecordingMetadata, ZoomKeyframe } from '../../types/metadata';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Timeline');

export class Timeline {
  private container: HTMLElement;
  private ruler: HTMLElement;
  private videoRow: HTMLElement;
  private zoomRow: HTMLElement;
  private playhead: HTMLElement;
  private metadata: RecordingMetadata | null = null;
  private duration: number = 0;
  private pixelsPerSecond: number = 100;
  private onSeek: ((time: number) => void) | null = null;
  private onZoomUpdate: ((keyframes: ZoomKeyframe[]) => void) | null = null;
  private draggedZoomSection: HTMLElement | null = null;
  private dragStartX: number = 0;
  private dragStartTime: number = 0;
  private selectedZoomSection: HTMLElement | null = null;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Timeline container not found: ${containerId}`);
    }
    this.container = container;

    // Find sub-elements
    this.ruler = container.querySelector('.timeline-ruler') as HTMLElement;
    const videoRow = container.querySelector('#video-row .timeline-row-content') as HTMLElement;
    const zoomRow = container.querySelector('#zoom-row .timeline-row-content') as HTMLElement;
    this.playhead = container.querySelector('.playhead') as HTMLElement;

    if (!this.ruler || !videoRow || !zoomRow || !this.playhead) {
      throw new Error('Timeline sub-elements not found');
    }

    this.videoRow = videoRow;
    this.zoomRow = zoomRow;

    this.setupEventListeners();
  }

  setMetadata(metadata: RecordingMetadata, duration: number) {
    this.metadata = metadata;
    this.duration = duration;
    this.updateTimelineWidth();
    // Force a reflow to ensure width is applied
    void this.ruler.offsetWidth;
    void this.videoRow.offsetWidth;
    void this.zoomRow.offsetWidth;
    this.render();
  }

  setOnSeek(callback: (time: number) => void) {
    this.onSeek = callback;
  }

  setOnZoomUpdate(callback: (keyframes: ZoomKeyframe[]) => void) {
    this.onZoomUpdate = callback;
  }

  /**
   * Calculate and set the timeline width based on duration
   */
  private updateTimelineWidth() {
    if (!this.duration || this.duration <= 0) return;

    // Calculate timeline width: duration in seconds * pixels per second
    const durationSeconds = this.duration / 1000;
    const timelineWidth = durationSeconds * this.pixelsPerSecond;
    const labelWidth = 100; // Width of the label column

    // Set width on ruler (ruler spans full width including label area)
    this.ruler.style.width = `${timelineWidth + labelWidth}px`;
    this.ruler.style.minWidth = `${timelineWidth + labelWidth}px`;
    this.ruler.style.maxWidth = `${timelineWidth + labelWidth}px`;
    this.ruler.style.right = 'auto';

    // Set width on row content areas (content starts after label)
    this.videoRow.style.width = `${timelineWidth}px`;
    this.videoRow.style.minWidth = `${timelineWidth}px`;
    this.videoRow.style.maxWidth = `${timelineWidth}px`;
    this.zoomRow.style.width = `${timelineWidth}px`;
    this.zoomRow.style.minWidth = `${timelineWidth}px`;
    this.zoomRow.style.maxWidth = `${timelineWidth}px`;
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

  updatePlayhead(time: number) {
    if (!this.duration) return;
    const labelWidth = 100; // Account for label width
    const position = (time * this.pixelsPerSecond) + labelWidth;
    this.playhead.style.left = `${position}px`;
  }

  private setupEventListeners() {
    let isDragging = false;

    this.container.addEventListener('mousedown', (e) => {
      // Don't start seeking if clicking on a zoom section
      if ((e.target as HTMLElement).closest('.zoom-section')) {
        return;
      }
      // Deselect zoom section if clicking elsewhere
      if (this.selectedZoomSection) {
        this.selectedZoomSection.classList.remove('selected');
        this.selectedZoomSection = null;
      }
      isDragging = true;
      this.handleSeek(e);
    });

    this.container.addEventListener('mousemove', (e) => {
      if (isDragging && !this.draggedZoomSection) {
        this.handleSeek(e);
      }
    });

    this.container.addEventListener('mouseup', () => {
      isDragging = false;
      this.draggedZoomSection = null;
    });

    this.container.addEventListener('mouseleave', () => {
      isDragging = false;
      this.draggedZoomSection = null;
    });

    this.container.addEventListener('click', (e) => {
      // Don't seek if clicking on a zoom section
      if ((e.target as HTMLElement).closest('.zoom-section')) {
        return;
      }
      // Deselect zoom section if clicking elsewhere
      if (this.selectedZoomSection) {
        this.selectedZoomSection.classList.remove('selected');
        this.selectedZoomSection = null;
      }
      this.handleSeek(e);
    });

    // Keyboard shortcuts for deletion
    this.container.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedZoomSection) {
        e.preventDefault();
        e.stopPropagation();
        this.deleteSelectedZoomSection();
      }
    });

    // Make container focusable for keyboard events
    this.container.setAttribute('tabindex', '0');
  }

  private handleSeek(e: MouseEvent) {
    if (!this.duration || this.duration <= 0) return;

    const rect = this.container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const scrollLeft = this.container.scrollLeft;
    const labelWidth = 100; // Account for label width
    let x = mouseX + scrollLeft - labelWidth; // Subtract label width to get position in content area

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

    // Clear existing content
    this.videoRow.innerHTML = '';
    this.zoomRow.innerHTML = '';

    // Render video section (full duration)
    this.renderVideoSection();

    // Render zoom sections as draggable regions
    this.renderZoomSections();

    // Render ruler
    this.renderRuler();
  }

  private renderVideoSection() {
    if (!this.duration || this.duration <= 0) return;

    const startTime = 0;
    const endTime = this.duration;
    const startPosition = (startTime / 1000) * this.pixelsPerSecond;
    const endPosition = (endTime / 1000) * this.pixelsPerSecond;
    const width = endPosition - startPosition;

    const section = document.createElement('div');
    section.className = 'video-section';
    section.style.left = `${startPosition}px`;
    section.style.width = `${width}px`;
    section.dataset.startTime = startTime.toString();
    section.dataset.endTime = endTime.toString();

    // Display video duration or label
    const durationSeconds = this.duration / 1000;
    const mins = Math.floor(durationSeconds / 60);
    const secs = Math.floor(durationSeconds % 60);
    section.textContent = `Video (${mins}:${secs.toString().padStart(2, '0')})`;

    this.videoRow.appendChild(section);
  }

  private renderZoomSections() {
    if (!this.metadata || !this.metadata.zoom.keyframes.length) return;

    const keyframes = this.metadata.zoom.keyframes;

    // Create segments from keyframes
    // Each segment is from one keyframe to the next (or to end of video)
    for (let i = 0; i < keyframes.length; i++) {
      const startKeyframe = keyframes[i];
      const endKeyframe = i < keyframes.length - 1
        ? keyframes[i + 1]
        : { ...startKeyframe, timestamp: this.duration, level: startKeyframe.level };

      // Only render sections where zoom level > 1.0
      if (startKeyframe.level > 1.0 || (endKeyframe.level && endKeyframe.level > 1.0)) {
        this.createZoomSection(startKeyframe, endKeyframe, i);
      }
    }
  }

  private createZoomSection(startKeyframe: ZoomKeyframe, endKeyframe: ZoomKeyframe, index: number) {
    if (!this.duration || this.duration === 0) return;

    const startTime = Math.max(0, Math.min(startKeyframe.timestamp, this.duration));
    const endTime = Math.max(0, Math.min(endKeyframe.timestamp, this.duration));

    if (startTime >= endTime) return;

    const startPosition = (startTime / 1000) * this.pixelsPerSecond;
    const endPosition = (endTime / 1000) * this.pixelsPerSecond;
    const width = endPosition - startPosition;

    const section = document.createElement('div');
    section.className = 'zoom-section';
    section.style.left = `${startPosition}px`;
    section.style.width = `${width}px`;
    section.dataset.startTime = startTime.toString();
    section.dataset.endTime = endTime.toString();
    section.dataset.index = index.toString();

    // Display zoom level
    const avgLevel = ((startKeyframe.level + endKeyframe.level) / 2).toFixed(1);
    section.textContent = `${avgLevel}x`;

    // Create resize handles
    const leftHandle = document.createElement('div');
    leftHandle.className = 'zoom-section-handle left';
    section.appendChild(leftHandle);

    const rightHandle = document.createElement('div');
    rightHandle.className = 'zoom-section-handle right';
    section.appendChild(rightHandle);

    // Setup drag handlers
    this.setupZoomSectionDrag(section, leftHandle, rightHandle);

    // Setup selection handler
    this.setupZoomSectionSelection(section);

    this.zoomRow.appendChild(section);
  }

  private setupZoomSectionSelection(section: HTMLElement) {
    let mouseDownTime = 0;
    let mouseDownX = 0;
    let mouseDownY = 0;
    let hasMoved = false;

    section.addEventListener('mousedown', (e) => {
      // Don't select if clicking on resize handles
      if ((e.target as HTMLElement).classList.contains('zoom-section-handle')) {
        return;
      }

      mouseDownTime = Date.now();
      mouseDownX = e.clientX;
      mouseDownY = e.clientY;
      hasMoved = false;
    });

    section.addEventListener('mousemove', (e) => {
      if (mouseDownTime > 0) {
        const deltaX = Math.abs(e.clientX - mouseDownX);
        const deltaY = Math.abs(e.clientY - mouseDownY);
        if (deltaX > 3 || deltaY > 3) {
          hasMoved = true;
        }
      }
    });

    section.addEventListener('mouseup', (e) => {
      if (mouseDownTime > 0) {
        const clickDuration = Date.now() - mouseDownTime;
        // If it was a quick click without movement, select the section
        if (clickDuration < 200 && !hasMoved && !this.draggedZoomSection) {
          e.stopPropagation();
          this.selectZoomSection(section);
        }
        mouseDownTime = 0;
        hasMoved = false;
      }
    });

    // Click to select (fallback)
    section.addEventListener('click', (e) => {
      // Only select if not dragging and not clicking on handles
      if (!this.draggedZoomSection &&
        !(e.target as HTMLElement).classList.contains('zoom-section-handle')) {
        e.stopPropagation();
        this.selectZoomSection(section);
      }
    });
  }

  private selectZoomSection(section: HTMLElement) {
    // Deselect previous
    if (this.selectedZoomSection) {
      this.selectedZoomSection.classList.remove('selected');
    }

    // Select new
    this.selectedZoomSection = section;
    section.classList.add('selected');

    // Focus the container to receive keyboard events
    this.container.focus();
  }

  private deleteSelectedZoomSection() {
    if (!this.selectedZoomSection || !this.metadata) return;

    const section = this.selectedZoomSection;
    const startTime = parseFloat(section.dataset.startTime || '0');
    const endTime = parseFloat(section.dataset.endTime || '0');

    // Remove keyframes within this section's time range
    const tolerance = 50; // 50ms tolerance
    const updatedKeyframes = this.metadata.zoom.keyframes.filter(kf => {
      // Keep keyframes that are clearly outside the section
      return kf.timestamp < (startTime - tolerance) || kf.timestamp > (endTime + tolerance);
    });

    // If we removed keyframes, update metadata
    if (updatedKeyframes.length !== this.metadata.zoom.keyframes.length) {
      this.metadata.zoom.keyframes = updatedKeyframes;

      // Notify update
      if (this.onZoomUpdate) {
        this.onZoomUpdate(updatedKeyframes);
      }

      // Re-render timeline
      this.render();

      // Clear selection
      this.selectedZoomSection = null;
    }
  }

  private setupZoomSectionDrag(section: HTMLElement, leftHandle: HTMLElement, rightHandle: HTMLElement) {
    let isDragging = false;
    let dragType: 'move' | 'resize-left' | 'resize-right' | null = null;
    let startX = 0;
    let startLeft = 0;
    let startWidth = 0;
    let startTime = 0;
    let endTime = 0;

    const handleMouseDown = (e: MouseEvent, type: 'move' | 'resize-left' | 'resize-right') => {
      e.stopPropagation();
      isDragging = true;
      dragType = type;
      this.draggedZoomSection = section;
      section.classList.add('dragging');

      // Select section when starting to drag
      this.selectZoomSection(section);

      const rect = this.zoomRow.getBoundingClientRect();
      startX = e.clientX - rect.left + this.zoomRow.scrollLeft;
      startLeft = parseFloat(section.style.left);
      startWidth = parseFloat(section.style.width);
      startTime = parseFloat(section.dataset.startTime || '0');
      endTime = parseFloat(section.dataset.endTime || '0');

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !this.metadata) return;

      const rect = this.zoomRow.getBoundingClientRect();
      const currentX = e.clientX - rect.left + this.zoomRow.scrollLeft;
      const deltaX = currentX - startX;
      const deltaTime = (deltaX / this.pixelsPerSecond) * 1000; // Convert to milliseconds

      if (dragType === 'move') {
        // Move the entire section
        const newStartTime = Math.max(0, Math.min(startTime + deltaTime, this.duration - (endTime - startTime)));
        const newEndTime = newStartTime + (endTime - startTime);

        if (newEndTime <= this.duration) {
          section.style.left = `${(newStartTime / 1000) * this.pixelsPerSecond}px`;
          section.dataset.startTime = newStartTime.toString();
          section.dataset.endTime = newEndTime.toString();
        }
      } else if (dragType === 'resize-left') {
        // Resize from left
        const newStartTime = Math.max(0, Math.min(startTime + deltaTime, endTime - 100)); // Min 100ms width
        const newWidth = ((endTime - newStartTime) / 1000) * this.pixelsPerSecond;

        if (newWidth > 20) { // Min 20px width
          section.style.left = `${(newStartTime / 1000) * this.pixelsPerSecond}px`;
          section.style.width = `${newWidth}px`;
          section.dataset.startTime = newStartTime.toString();
        }
      } else if (dragType === 'resize-right') {
        // Resize from right
        const newEndTime = Math.max(startTime + 100, Math.min(endTime + deltaTime, this.duration)); // Min 100ms width
        const newWidth = ((newEndTime - startTime) / 1000) * this.pixelsPerSecond;

        if (newWidth > 20) { // Min 20px width
          section.style.width = `${newWidth}px`;
          section.dataset.endTime = newEndTime.toString();
        }
      }
    };

    const handleMouseUp = () => {
      if (isDragging && this.metadata) {
        // Update keyframes based on new positions
        this.updateZoomKeyframesFromSections();
      }

      isDragging = false;
      dragType = null;
      this.draggedZoomSection = null;
      section.classList.remove('dragging');

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Setup event listeners
    section.addEventListener('mousedown', (e) => {
      if (e.target === leftHandle || e.target === rightHandle) return;
      handleMouseDown(e, 'move');
    });

    leftHandle.addEventListener('mousedown', (e) => handleMouseDown(e, 'resize-left'));
    rightHandle.addEventListener('mousedown', (e) => handleMouseDown(e, 'resize-right'));
  }

  private updateZoomKeyframesFromSections() {
    if (!this.metadata) return;

    const sections = Array.from(this.zoomRow.querySelectorAll('.zoom-section')) as HTMLElement[];
    const updatedKeyframes: ZoomKeyframe[] = [...this.metadata.zoom.keyframes];

    // Update timestamps for keyframes based on section positions
    sections.forEach((section) => {
      const startTime = parseFloat(section.dataset.startTime || '0');
      const endTime = parseFloat(section.dataset.endTime || '0');
      const index = parseInt(section.dataset.index || '0');

      // Update the start keyframe timestamp
      if (index < updatedKeyframes.length) {
        updatedKeyframes[index] = { ...updatedKeyframes[index], timestamp: startTime };
      }

      // Update the end keyframe timestamp (next keyframe)
      if (index + 1 < updatedKeyframes.length) {
        updatedKeyframes[index + 1] = { ...updatedKeyframes[index + 1], timestamp: endTime };
      } else if (index < updatedKeyframes.length) {
        // If this is the last section, add a keyframe at the end time
        const lastKeyframe = updatedKeyframes[updatedKeyframes.length - 1];
        updatedKeyframes.push({ ...lastKeyframe, timestamp: endTime });
      }
    });

    // Sort by timestamp and remove duplicates
    updatedKeyframes.sort((a, b) => a.timestamp - b.timestamp);
    const uniqueKeyframes: ZoomKeyframe[] = [];
    const tolerance = 50; // 50ms tolerance for duplicate detection

    updatedKeyframes.forEach((kf) => {
      const isDuplicate = uniqueKeyframes.some(
        existing => Math.abs(existing.timestamp - kf.timestamp) < tolerance
      );
      if (!isDuplicate) {
        uniqueKeyframes.push(kf);
      }
    });

    // Update metadata and notify
    if (this.onZoomUpdate) {
      this.metadata.zoom.keyframes = uniqueKeyframes;
      this.onZoomUpdate(uniqueKeyframes);
    }
  }

  private renderRuler() {
    if (!this.ruler || !this.duration) return;

    // Clear existing ruler marks
    const existingMarks = this.ruler.querySelectorAll('.ruler-mark');
    existingMarks.forEach(mark => mark.remove());

    const timelineWidth = this.getTimelineWidth();
    const interval = this.calculateRulerInterval();
    const marks: number[] = [];
    const labelWidth = 100; // Account for label width

    for (let time = 0; time <= this.duration; time += interval) {
      marks.push(time);
    }

    marks.forEach(time => {
      const timeSeconds = time / 1000;
      const position = (timeSeconds * this.pixelsPerSecond) + labelWidth; // Add label width offset

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
