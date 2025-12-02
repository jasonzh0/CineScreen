import type { RecordingMetadata } from '../../types/metadata';

export class VideoPreview {
  private videoElement: HTMLVideoElement;
  private cursorCanvas: HTMLCanvasElement;
  private zoomCanvas: HTMLCanvasElement;
  private wrapper: HTMLElement;
  private metadata: RecordingMetadata | null = null;
  private onTimeUpdate: ((time: number) => void) | null = null;
  private onSeek: ((time: number) => void) | null = null;

  constructor(
    videoId: string,
    cursorCanvasId: string,
    zoomCanvasId: string,
    wrapperId: string
  ) {
    const video = document.getElementById(videoId) as HTMLVideoElement;
    const cursorCanvas = document.getElementById(cursorCanvasId) as HTMLCanvasElement;
    const zoomCanvas = document.getElementById(zoomCanvasId) as HTMLCanvasElement;
    const wrapper = document.getElementById(wrapperId) as HTMLElement;

    if (!video || !cursorCanvas || !zoomCanvas || !wrapper) {
      throw new Error('Video preview elements not found');
    }

    this.videoElement = video;
    this.cursorCanvas = cursorCanvas;
    this.zoomCanvas = zoomCanvas;
    this.wrapper = wrapper;

    this.setupEventListeners();
  }

  setMetadata(metadata: RecordingMetadata) {
    this.metadata = metadata;
  }

  setOnTimeUpdate(callback: (time: number) => void) {
    this.onTimeUpdate = callback;
  }

  setOnSeek(callback: (time: number) => void) {
    this.onSeek = callback;
  }

  getVideoElement(): HTMLVideoElement {
    return this.videoElement;
  }

  getCursorCanvas(): HTMLCanvasElement {
    return this.cursorCanvas;
  }

  getZoomCanvas(): HTMLCanvasElement {
    return this.zoomCanvas;
  }

  seekTo(time: number) {
    this.videoElement.currentTime = time;
  }

  play() {
    return this.videoElement.play();
  }

  pause() {
    this.videoElement.pause();
  }

  isPlaying(): boolean {
    return !this.videoElement.paused;
  }

  getCurrentTime(): number {
    return this.videoElement.currentTime;
  }

  getDuration(): number {
    return this.videoElement.duration;
  }

  private setupEventListeners() {
    // Resize canvases when video loads or resizes
    this.videoElement.addEventListener('loadedmetadata', () => {
      this.resizeCanvases();
    });

    this.videoElement.addEventListener('timeupdate', () => {
      const time = this.videoElement.currentTime * 1000; // Convert to ms
      if (this.onTimeUpdate) {
        this.onTimeUpdate(time);
      }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      this.resizeCanvases();
    });

    // Handle video resize (when video element size changes)
    this.videoElement.addEventListener('resize', () => {
      this.resizeCanvases();
    });

    // Also resize on video loadeddata to ensure proper initial sizing
    this.videoElement.addEventListener('loadeddata', () => {
      this.resizeCanvases();
    });

    // Handle video click for seeking (if needed)
    this.videoElement.addEventListener('click', (e) => {
      const rect = this.videoElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = (x / rect.width) * this.videoElement.duration;
      if (this.onSeek) {
        this.onSeek(time);
      }
    });
  }

  private resizeCanvases() {
    const videoRect = this.videoElement.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();
    
    // Calculate video position relative to wrapper
    const videoX = videoRect.left - wrapperRect.left;
    const videoY = videoRect.top - wrapperRect.top;
    
    // Set canvas size to match video display size
    this.cursorCanvas.width = videoRect.width;
    this.cursorCanvas.height = videoRect.height;
    this.cursorCanvas.style.width = `${videoRect.width}px`;
    this.cursorCanvas.style.height = `${videoRect.height}px`;
    this.cursorCanvas.style.left = `${videoX}px`;
    this.cursorCanvas.style.top = `${videoY}px`;

    this.zoomCanvas.width = videoRect.width;
    this.zoomCanvas.height = videoRect.height;
    this.zoomCanvas.style.width = `${videoRect.width}px`;
    this.zoomCanvas.style.height = `${videoRect.height}px`;
    this.zoomCanvas.style.left = `${videoX}px`;
    this.zoomCanvas.style.top = `${videoY}px`;
  }
}

