import type { RecordingMetadata } from '../../types/metadata';
import type { ZoomSection } from '../../processing/zoom-tracker';

export class KeyframePanel {
  private container: HTMLElement;
  private zoomList: HTMLElement;
  private metadata: RecordingMetadata | null = null;
  private onSeek: ((time: number) => void) | null = null;
  private onDeleteZoomSection: ((startTime: number) => void) | null = null;
  private onUpdateZoomSection: ((startTime: number, updates: Partial<ZoomSection>) => void) | null = null;
  private onSelectZoomSection: ((startTime: number) => void) | null = null;
  private selectedStartTime: number | null = null;
  private sectionElements: Map<number, HTMLElement> = new Map();

  constructor(zoomListId: string) {
    const zoomList = document.getElementById(zoomListId);

    if (!zoomList) {
      throw new Error('Zoom keyframe panel container not found');
    }

    this.zoomList = zoomList;
    this.container = zoomList.parentElement || document.body;
  }

  setMetadata(metadata: RecordingMetadata) {
    this.metadata = metadata;
    this.render();
  }

  setOnSeek(callback: (time: number) => void) {
    this.onSeek = callback;
  }

  setOnDeleteZoomKeyframe(callback: (startTime: number) => void) {
    this.onDeleteZoomSection = callback;
  }

  setOnUpdateZoomSegment(callback: (startTime: number, updates: Partial<ZoomSection>) => void) {
    this.onUpdateZoomSection = callback;
  }

  setOnSelectZoomSection(callback: (startTime: number) => void) {
    this.onSelectZoomSection = callback;
  }

  selectZoomSection(startTime: number) {
    // Deselect previous
    if (this.selectedStartTime !== null) {
      const prevElement = this.sectionElements.get(this.selectedStartTime);
      if (prevElement) {
        prevElement.style.border = '1px solid #4a4a4a';
        prevElement.style.boxShadow = 'none';
      }
    }

    // Select new
    this.selectedStartTime = startTime;
    const element = this.sectionElements.get(startTime);
    if (element) {
      element.style.border = '1px solid #6e9eff';
      element.style.boxShadow = '0 0 8px rgba(110, 158, 255, 0.4)';
      // Scroll into view
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  deselectZoomSection() {
    if (this.selectedStartTime !== null) {
      const prevElement = this.sectionElements.get(this.selectedStartTime);
      if (prevElement) {
        prevElement.style.border = '1px solid #4a4a4a';
        prevElement.style.boxShadow = 'none';
      }
      this.selectedStartTime = null;
    }
  }

  private render() {
    if (!this.metadata) return;

    this.renderZoomSections();
  }

  private renderZoomSections() {
    this.zoomList.innerHTML = '';
    this.sectionElements.clear();

    if (!this.metadata) return;

    const sections = this.metadata.zoom.sections;

    if (sections.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No zoom sections. Add sections using the button above or they will be auto-generated from mouse movement.';
      empty.style.padding = '10px';
      empty.style.color = '#999';
      empty.style.fontSize = '12px';
      empty.style.textAlign = 'center';
      this.zoomList.appendChild(empty);
      return;
    }

    sections.forEach((section, index) => {
      const item = this.createSectionItem(section, index);
      this.sectionElements.set(section.startTime, item);
      this.zoomList.appendChild(item);
    });

    // Re-apply selection if there was one
    if (this.selectedStartTime !== null && this.sectionElements.has(this.selectedStartTime)) {
      this.selectZoomSection(this.selectedStartTime);
    }
  }

  private createSectionItem(section: ZoomSection, index: number): HTMLElement {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.flexDirection = 'column';
    item.style.gap = '8px';
    item.style.padding = '10px';
    item.style.marginBottom = '8px';
    item.style.background = '#3a3a3a';
    item.style.borderRadius = '4px';
    item.style.border = '1px solid #4a4a4a';
    item.style.cursor = 'pointer';
    item.style.transition = 'border-color 0.15s, box-shadow 0.15s';

    // Click to select section
    item.addEventListener('click', (e) => {
      // Don't select if clicking on inputs or buttons
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;

      this.selectZoomSection(section.startTime);
      if (this.onSelectZoomSection) {
        this.onSelectZoomSection(section.startTime);
      }
    });

    // Header row with time range
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const timeRange = document.createElement('div');
    timeRange.style.display = 'flex';
    timeRange.style.alignItems = 'center';
    timeRange.style.gap = '8px';
    timeRange.style.fontWeight = '600';
    timeRange.style.fontSize = '12px';
    timeRange.style.cursor = 'pointer';

    const startTime = this.formatTime(section.startTime / 1000);
    const endTime = this.formatTime(section.endTime / 1000);

    timeRange.innerHTML = `
      <span>${startTime}</span>
      <span style="color: #666;">→</span>
      <span>${endTime}</span>
    `;

    timeRange.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onSeek) {
        this.onSeek(section.startTime / 1000);
      }
      // Also select the section
      this.selectZoomSection(section.startTime);
      if (this.onSelectZoomSection) {
        this.onSelectZoomSection(section.startTime);
      }
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete zoom section';
    deleteBtn.style.background = 'transparent';
    deleteBtn.style.border = 'none';
    deleteBtn.style.color = '#ff6b6b';
    deleteBtn.style.fontSize = '20px';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.padding = '0 6px';

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onDeleteZoomSection) {
        this.onDeleteZoomSection(section.startTime);
      }
    });

    header.appendChild(timeRange);
    header.appendChild(deleteBtn);

    // Editable properties
    const propertiesContainer = document.createElement('div');
    propertiesContainer.style.display = 'flex';
    propertiesContainer.style.flexDirection = 'column';
    propertiesContainer.style.gap = '8px';

    // Scale editor with drag-to-adjust
    const scaleRow = document.createElement('div');
    scaleRow.style.display = 'flex';
    scaleRow.style.alignItems = 'center';
    scaleRow.style.gap = '8px';
    scaleRow.style.fontSize = '11px';

    const scaleLabel = document.createElement('label');
    scaleLabel.textContent = 'Scale:';
    scaleLabel.style.color = '#999';
    scaleLabel.style.width = '60px';
    scaleLabel.style.flexShrink = '0';

    const { container: scaleContainer, input: scaleInput, display: scaleDisplay } = this.createDraggableInput({
      value: section.scale,
      min: 1.0,
      max: 5.0,
      step: 0.1,
      sensitivity: 0.01,
      format: (v) => `${v.toFixed(1)}x`,
      onChange: (newScale) => {
        if (this.onUpdateZoomSection) {
          this.onUpdateZoomSection(section.startTime, { scale: newScale });
        }
      }
    });

    scaleRow.appendChild(scaleLabel);
    scaleRow.appendChild(scaleContainer);

    // Center X editor with drag-to-adjust
    const centerXRow = document.createElement('div');
    centerXRow.style.display = 'flex';
    centerXRow.style.alignItems = 'center';
    centerXRow.style.gap = '8px';
    centerXRow.style.fontSize = '11px';

    const centerXLabel = document.createElement('label');
    centerXLabel.textContent = 'Center X:';
    centerXLabel.style.color = '#999';
    centerXLabel.style.width = '60px';
    centerXLabel.style.flexShrink = '0';

    const { container: centerXContainer } = this.createDraggableInput({
      value: Math.round(section.centerX),
      min: 0,
      max: this.metadata?.video.width || 3840,
      step: 1,
      sensitivity: 2,
      format: (v) => Math.round(v).toString(),
      onChange: (newCenterX) => {
        if (this.onUpdateZoomSection) {
          this.onUpdateZoomSection(section.startTime, { centerX: newCenterX });
        }
      }
    });

    centerXRow.appendChild(centerXLabel);
    centerXRow.appendChild(centerXContainer);

    // Center Y editor with drag-to-adjust
    const centerYRow = document.createElement('div');
    centerYRow.style.display = 'flex';
    centerYRow.style.alignItems = 'center';
    centerYRow.style.gap = '8px';
    centerYRow.style.fontSize = '11px';

    const centerYLabel = document.createElement('label');
    centerYLabel.textContent = 'Center Y:';
    centerYLabel.style.color = '#999';
    centerYLabel.style.width = '60px';
    centerYLabel.style.flexShrink = '0';

    const { container: centerYContainer } = this.createDraggableInput({
      value: Math.round(section.centerY),
      min: 0,
      max: this.metadata?.video.height || 2160,
      step: 1,
      sensitivity: 2,
      format: (v) => Math.round(v).toString(),
      onChange: (newCenterY) => {
        if (this.onUpdateZoomSection) {
          this.onUpdateZoomSection(section.startTime, { centerY: newCenterY });
        }
      }
    });

    centerYRow.appendChild(centerYLabel);
    centerYRow.appendChild(centerYContainer);

    // Duration info (read-only)
    const duration = section.endTime - section.startTime;
    const durationInfo = document.createElement('div');
    durationInfo.style.fontSize = '11px';
    durationInfo.style.color = '#666';
    durationInfo.style.marginTop = '4px';
    durationInfo.textContent = `Duration: ${(duration / 1000).toFixed(2)}s`;

    propertiesContainer.appendChild(scaleRow);
    propertiesContainer.appendChild(centerXRow);
    propertiesContainer.appendChild(centerYRow);
    propertiesContainer.appendChild(durationInfo);

    item.appendChild(header);
    item.appendChild(propertiesContainer);

    return item;
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }

  private createDraggableInput(options: {
    value: number;
    min: number;
    max: number;
    step: number;
    sensitivity: number;
    format: (value: number) => string;
    onChange: (value: number) => void;
  }): { container: HTMLElement; input: HTMLInputElement; display: HTMLElement } {
    const { value, min, max, step, sensitivity, format, onChange } = options;

    const container = document.createElement('div');
    container.style.flex = '1';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.position = 'relative';

    const input = document.createElement('input');
    input.type = 'number';
    input.value = format(value).replace(/[^0-9.-]/g, '');
    input.style.width = '100%';
    input.style.background = '#2a2a2a';
    input.style.border = '1px solid #4a4a4a';
    input.style.color = '#e0e0e0';
    input.style.padding = '4px 8px';
    input.style.borderRadius = '4px';
    input.style.fontSize = '11px';
    input.style.cursor = 'ew-resize';
    input.min = min.toString();
    input.max = max.toString();
    input.step = step.toString();

    const display = document.createElement('span');
    display.textContent = format(value);
    display.style.position = 'absolute';
    display.style.right = '8px';
    display.style.pointerEvents = 'none';
    display.style.color = '#888';
    display.style.fontSize = '10px';

    container.appendChild(input);

    // Check if this is a non-integer format (has suffix like 'x')
    const hasUnit = format(value) !== Math.round(value).toString();
    if (hasUnit) {
      container.appendChild(display);
    }

    let currentValue = value;
    let isDragging = false;
    let startX = 0;
    let startValue = 0;

    // Handle direct input changes
    input.addEventListener('change', (e) => {
      e.stopPropagation();
      let newValue = parseFloat((e.target as HTMLInputElement).value);
      if (!isNaN(newValue)) {
        newValue = Math.max(min, Math.min(max, newValue));
        // Round to step
        newValue = Math.round(newValue / step) * step;
        currentValue = newValue;
        input.value = hasUnit ? newValue.toFixed(1) : Math.round(newValue).toString();
        display.textContent = format(newValue);
        onChange(newValue);
      }
    });

    // Drag to adjust
    const handleMouseDown = (e: MouseEvent) => {
      // Only start drag if not clicking to edit text
      if (document.activeElement === input) return;

      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      startValue = currentValue;
      input.style.cursor = 'ew-resize';
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      let newValue = startValue + (deltaX * sensitivity);

      // Clamp to bounds
      newValue = Math.max(min, Math.min(max, newValue));

      // Round to step
      newValue = Math.round(newValue / step) * step;

      if (newValue !== currentValue) {
        currentValue = newValue;
        input.value = hasUnit ? newValue.toFixed(1) : Math.round(newValue).toString();
        display.textContent = format(newValue);
        onChange(newValue);
      }
    };

    const handleMouseUp = () => {
      isDragging = false;
      input.style.cursor = 'ew-resize';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    input.addEventListener('mousedown', handleMouseDown);

    // Double-click to edit directly
    input.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      input.style.cursor = 'text';
      input.select();
    });

    // Blur to reset cursor
    input.addEventListener('blur', () => {
      input.style.cursor = 'ew-resize';
    });

    return { container, input, display };
  }
}

