import type { RecordingMetadata, CursorKeyframe, ZoomKeyframe, CursorSegment, ZoomSegment, EasingType } from '../../types/metadata';

export class KeyframePanel {
  private container: HTMLElement;
  private cursorList: HTMLElement;
  private zoomList: HTMLElement;
  private metadata: RecordingMetadata | null = null;
  private onSeek: ((time: number) => void) | null = null;
  private onDeleteCursorKeyframe: ((timestamp: number) => void) | null = null;
  private onDeleteZoomKeyframe: ((timestamp: number) => void) | null = null;
  private onUpdateCursorSegment: ((segment: CursorSegment) => void) | null = null;
  private onUpdateZoomSegment: ((segment: ZoomSegment) => void) | null = null;

  constructor(
    cursorListId: string,
    zoomListId: string
  ) {
    const cursorList = document.getElementById(cursorListId);
    const zoomList = document.getElementById(zoomListId);

    if (!cursorList || !zoomList) {
      throw new Error('Keyframe panel containers not found');
    }

    this.cursorList = cursorList;
    this.zoomList = zoomList;
    this.container = cursorList.parentElement || document.body;
  }

  setMetadata(metadata: RecordingMetadata) {
    this.metadata = metadata;
    this.render();
  }

  setOnSeek(callback: (time: number) => void) {
    this.onSeek = callback;
  }

  setOnDeleteCursorKeyframe(callback: (timestamp: number) => void) {
    this.onDeleteCursorKeyframe = callback;
  }

  setOnDeleteZoomKeyframe(callback: (timestamp: number) => void) {
    this.onDeleteZoomKeyframe = callback;
  }

  setOnUpdateCursorSegment(callback: (segment: CursorSegment) => void) {
    this.onUpdateCursorSegment = callback;
  }

  setOnUpdateZoomSegment(callback: (segment: ZoomSegment) => void) {
    this.onUpdateZoomSegment = callback;
  }

  private render() {
    if (!this.metadata) return;

    this.renderCursorSegments();
    this.renderZoomSegments();
  }

  /**
   * Convert keyframes to segments
   */
  private keyframesToCursorSegments(keyframes: CursorKeyframe[]): CursorSegment[] {
    if (keyframes.length < 2) return [];
    
    const segments: CursorSegment[] = [];
    for (let i = 0; i < keyframes.length - 1; i++) {
      const start = keyframes[i];
      const end = keyframes[i + 1];
      segments.push({
        start,
        end,
        easing: end.easing || start.easing || 'easeInOut',
      });
    }
    return segments;
  }

  private keyframesToZoomSegments(keyframes: ZoomKeyframe[]): ZoomSegment[] {
    if (keyframes.length < 2) return [];
    
    const segments: ZoomSegment[] = [];
    for (let i = 0; i < keyframes.length - 1; i++) {
      const start = keyframes[i];
      const end = keyframes[i + 1];
      segments.push({
        start,
        end,
        easing: end.easing || start.easing || 'easeInOut',
      });
    }
    return segments;
  }

  private renderCursorSegments() {
    this.cursorList.innerHTML = '';

    if (!this.metadata) return;

    const segments = this.keyframesToCursorSegments(this.metadata.cursor.keyframes);
    
    segments.forEach((segment, index) => {
      const item = this.createSegmentItem(
        segment,
        'cursor',
        index,
        this.formatTime(segment.start.timestamp / 1000),
        this.formatTime(segment.end.timestamp / 1000),
        `(${Math.round(segment.start.x)}, ${Math.round(segment.start.y)}) → (${Math.round(segment.end.x)}, ${Math.round(segment.end.y)})`
      );
      this.cursorList.appendChild(item);
    });

    if (segments.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No cursor segments (need at least 2 keyframes)';
      empty.style.padding = '10px';
      empty.style.color = '#999';
      this.cursorList.appendChild(empty);
    }
  }

  private renderZoomSegments() {
    this.zoomList.innerHTML = '';

    if (!this.metadata) return;

    const segments = this.keyframesToZoomSegments(this.metadata.zoom.keyframes);
    
    segments.forEach((segment, index) => {
      const item = this.createSegmentItem(
        segment,
        'zoom',
        index,
        this.formatTime(segment.start.timestamp / 1000),
        this.formatTime(segment.end.timestamp / 1000),
        `${segment.start.level.toFixed(1)}x → ${segment.end.level.toFixed(1)}x`
      );
      this.zoomList.appendChild(item);
    });

    if (segments.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No zoom segments (need at least 2 keyframes)';
      empty.style.padding = '10px';
      empty.style.color = '#999';
      this.zoomList.appendChild(empty);
    }
  }

  private createSegmentItem(
    segment: CursorSegment | ZoomSegment,
    type: 'cursor' | 'zoom',
    index: number,
    startTime: string,
    endTime: string,
    details: string
  ): HTMLElement {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.flexDirection = 'column';
    item.style.gap = '8px';
    item.style.padding = '10px';
    item.style.marginBottom = '8px';
    item.style.background = '#3a3a3a';
    item.style.borderRadius = '4px';
    item.style.border = '1px solid #4a4a4a';

    // Header row with time range and curve selector
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
    
    timeRange.innerHTML = `
      <span>${startTime}</span>
      <span style="color: #666;">→</span>
      <span>${endTime}</span>
    `;

    timeRange.addEventListener('click', () => {
      if (this.onSeek) {
        this.onSeek(segment.start.timestamp / 1000);
      }
    });

    // Curve selector
    const curveSelector = document.createElement('select');
    curveSelector.style.background = '#2a2a2a';
    curveSelector.style.border = '1px solid #4a4a4a';
    curveSelector.style.borderRadius = '4px';
    curveSelector.style.color = '#e0e0e0';
    curveSelector.style.padding = '4px 8px';
    curveSelector.style.fontSize = '11px';
    curveSelector.style.cursor = 'pointer';

    const easingTypes: EasingType[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
    easingTypes.forEach(easing => {
      const option = document.createElement('option');
      option.value = easing;
      option.textContent = easing;
      if (segment.easing === easing) {
        option.selected = true;
      }
      curveSelector.appendChild(option);
    });

    curveSelector.addEventListener('change', (e) => {
      const newEasing = (e.target as HTMLSelectElement).value as EasingType;
      const updatedSegment = { ...segment, easing: newEasing };
      if (type === 'cursor' && this.onUpdateCursorSegment) {
        this.onUpdateCursorSegment(updatedSegment as CursorSegment);
      } else if (type === 'zoom' && this.onUpdateZoomSegment) {
        this.onUpdateZoomSegment(updatedSegment as ZoomSegment);
      }
    });

    header.appendChild(timeRange);
    header.appendChild(curveSelector);

    // Details row
    const detailsRow = document.createElement('div');
    detailsRow.style.display = 'flex';
    detailsRow.style.justifyContent = 'space-between';
    detailsRow.style.alignItems = 'center';

    const detailsLabel = document.createElement('div');
    detailsLabel.textContent = details;
    detailsLabel.style.fontSize = '11px';
    detailsLabel.style.color = '#999';

    // Delete buttons for start and end keyframes
    const deleteControls = document.createElement('div');
    deleteControls.style.display = 'flex';
    deleteControls.style.gap = '4px';

    const deleteStartBtn = document.createElement('button');
    deleteStartBtn.textContent = '×';
    deleteStartBtn.title = 'Delete start keyframe';
    deleteStartBtn.style.background = 'transparent';
    deleteStartBtn.style.border = 'none';
    deleteStartBtn.style.color = '#ff6b6b';
    deleteStartBtn.style.fontSize = '16px';
    deleteStartBtn.style.cursor = 'pointer';
    deleteStartBtn.style.padding = '2px 6px';

    deleteStartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (type === 'cursor' && this.onDeleteCursorKeyframe) {
        this.onDeleteCursorKeyframe(segment.start.timestamp);
      } else if (type === 'zoom' && this.onDeleteZoomKeyframe) {
        this.onDeleteZoomKeyframe(segment.start.timestamp);
      }
    });

    const deleteEndBtn = document.createElement('button');
    deleteEndBtn.textContent = '×';
    deleteEndBtn.title = 'Delete end keyframe';
    deleteEndBtn.style.background = 'transparent';
    deleteEndBtn.style.border = 'none';
    deleteEndBtn.style.color = '#ff6b6b';
    deleteEndBtn.style.fontSize = '16px';
    deleteEndBtn.style.cursor = 'pointer';
    deleteEndBtn.style.padding = '2px 6px';

    deleteEndBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (type === 'cursor' && this.onDeleteCursorKeyframe) {
        this.onDeleteCursorKeyframe(segment.end.timestamp);
      } else if (type === 'zoom' && this.onDeleteZoomKeyframe) {
        this.onDeleteZoomKeyframe(segment.end.timestamp);
      }
    });

    deleteControls.appendChild(deleteStartBtn);
    deleteControls.appendChild(deleteEndBtn);

    detailsRow.appendChild(detailsLabel);
    detailsRow.appendChild(deleteControls);

    item.appendChild(header);
    item.appendChild(detailsRow);

    return item;
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

