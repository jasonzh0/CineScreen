import type { RecordingMetadata } from '../../types/metadata';
import type { ZoomSection } from '../../processing/zoom-tracker';

export class KeyframePanel {
  private container: HTMLElement;
  private zoomList: HTMLElement;
  private metadata: RecordingMetadata | null = null;
  private onSeek: ((time: number) => void) | null = null;
  private onDeleteZoomSection: ((startTime: number) => void) | null = null;
  private onUpdateZoomSection: ((startTime: number, updates: Partial<ZoomSection>) => void) | null = null;

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

  private render() {
    if (!this.metadata) return;

    this.renderZoomSections();
  }

  private renderZoomSections() {
    this.zoomList.innerHTML = '';

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
      this.zoomList.appendChild(item);
    });
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

    timeRange.addEventListener('click', () => {
      if (this.onSeek) {
        this.onSeek(section.startTime / 1000);
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

    // Scale editor
    const scaleRow = document.createElement('div');
    scaleRow.style.display = 'flex';
    scaleRow.style.alignItems = 'center';
    scaleRow.style.gap = '8px';
    scaleRow.style.fontSize = '11px';

    const scaleLabel = document.createElement('label');
    scaleLabel.textContent = 'Scale:';
    scaleLabel.style.color = '#999';
    scaleLabel.style.minWidth = '50px';

    const scaleInput = document.createElement('input');
    scaleInput.type = 'range';
    scaleInput.min = '1.0';
    scaleInput.max = '5.0';
    scaleInput.step = '0.1';
    scaleInput.value = section.scale.toString();
    scaleInput.style.flex = '1';
    scaleInput.style.height = '4px';
    scaleInput.style.background = '#3a3a3a';
    scaleInput.style.borderRadius = '2px';

    const scaleValue = document.createElement('span');
    scaleValue.textContent = `${section.scale.toFixed(1)}x`;
    scaleValue.style.color = '#e0e0e0';
    scaleValue.style.minWidth = '40px';
    scaleValue.style.textAlign = 'right';

    scaleInput.addEventListener('input', (e) => {
      const newScale = parseFloat((e.target as HTMLInputElement).value);
      scaleValue.textContent = `${newScale.toFixed(1)}x`;
      if (this.onUpdateZoomSection) {
        this.onUpdateZoomSection(section.startTime, { scale: newScale });
      }
    });

    scaleRow.appendChild(scaleLabel);
    scaleRow.appendChild(scaleInput);
    scaleRow.appendChild(scaleValue);

    // Center X editor
    const centerXRow = document.createElement('div');
    centerXRow.style.display = 'flex';
    centerXRow.style.alignItems = 'center';
    centerXRow.style.gap = '8px';
    centerXRow.style.fontSize = '11px';

    const centerXLabel = document.createElement('label');
    centerXLabel.textContent = 'Center X:';
    centerXLabel.style.color = '#999';
    centerXLabel.style.minWidth = '50px';

    const centerXInput = document.createElement('input');
    centerXInput.type = 'number';
    centerXInput.value = Math.round(section.centerX).toString();
    centerXInput.style.flex = '1';
    centerXInput.style.background = '#2a2a2a';
    centerXInput.style.border = '1px solid #4a4a4a';
    centerXInput.style.color = '#e0e0e0';
    centerXInput.style.padding = '4px 8px';
    centerXInput.style.borderRadius = '4px';
    centerXInput.style.fontSize = '11px';

    centerXInput.addEventListener('change', (e) => {
      const newCenterX = parseFloat((e.target as HTMLInputElement).value);
      if (!isNaN(newCenterX) && this.onUpdateZoomSection) {
        this.onUpdateZoomSection(section.startTime, { centerX: newCenterX });
      }
    });

    centerXRow.appendChild(centerXLabel);
    centerXRow.appendChild(centerXInput);

    // Center Y editor
    const centerYRow = document.createElement('div');
    centerYRow.style.display = 'flex';
    centerYRow.style.alignItems = 'center';
    centerYRow.style.gap = '8px';
    centerYRow.style.fontSize = '11px';

    const centerYLabel = document.createElement('label');
    centerYLabel.textContent = 'Center Y:';
    centerYLabel.style.color = '#999';
    centerYLabel.style.minWidth = '50px';

    const centerYInput = document.createElement('input');
    centerYInput.type = 'number';
    centerYInput.value = Math.round(section.centerY).toString();
    centerYInput.style.flex = '1';
    centerYInput.style.background = '#2a2a2a';
    centerYInput.style.border = '1px solid #4a4a4a';
    centerYInput.style.color = '#e0e0e0';
    centerYInput.style.padding = '4px 8px';
    centerYInput.style.borderRadius = '4px';
    centerYInput.style.fontSize = '11px';

    centerYInput.addEventListener('change', (e) => {
      const newCenterY = parseFloat((e.target as HTMLInputElement).value);
      if (!isNaN(newCenterY) && this.onUpdateZoomSection) {
        this.onUpdateZoomSection(section.startTime, { centerY: newCenterY });
      }
    });

    centerYRow.appendChild(centerYLabel);
    centerYRow.appendChild(centerYInput);

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
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }
}

