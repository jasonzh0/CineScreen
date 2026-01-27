import React, { useRef, useEffect, useCallback } from 'react';
import { useStudio } from '../../context/StudioContext';
import { renderCursor, resetCursorSmoothing } from '../../../utils/cursor-renderer';
import { renderZoom } from '../../../utils/zoom-renderer';
import { PlaybackControls } from './PlaybackControls';

export function VideoPreview() {
  const {
    metadata,
    videoPath,
    videoRef,
    currentTime,
    isPlaying,
    seekTo,
  } = useStudio();

  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const renderPreview = useCallback(() => {
    if (!metadata || !videoRef.current || !cursorCanvasRef.current || !zoomCanvasRef.current || !wrapperRef.current) return;

    const videoEl = videoRef.current;
    const cursorCanvas = cursorCanvasRef.current;
    const zoomCanvas = zoomCanvasRef.current;

    const videoRect = videoEl.getBoundingClientRect();
    const wrapperRect = wrapperRef.current.getBoundingClientRect();

    const videoX = videoRect.left - wrapperRect.left;
    const videoY = videoRect.top - wrapperRect.top;

    const videoWidth = metadata.video.width;
    const videoHeight = metadata.video.height;

    // Calculate aspect ratio letterboxing
    const videoAspectRatio = videoWidth / videoHeight;
    const containerAspectRatio = videoRect.width / videoRect.height;

    let actualVideoDisplayWidth: number;
    let actualVideoDisplayHeight: number;

    if (videoAspectRatio > containerAspectRatio) {
      actualVideoDisplayWidth = videoRect.width;
      actualVideoDisplayHeight = videoRect.width / videoAspectRatio;
    } else {
      actualVideoDisplayWidth = videoRect.height * videoAspectRatio;
      actualVideoDisplayHeight = videoRect.height;
    }

    // Update canvas positions and sizes
    [cursorCanvas, zoomCanvas].forEach(canvas => {
      canvas.width = videoRect.width;
      canvas.height = videoRect.height;
      canvas.style.width = `${videoRect.width}px`;
      canvas.style.height = `${videoRect.height}px`;
      canvas.style.left = `${videoX}px`;
      canvas.style.top = `${videoY}px`;
      canvas.style.position = 'absolute';
    });

    // Use React state directly - this is now the source of truth
    const videoCurrentTime = currentTime;
    const videoContentOffsetX = (videoRect.width - actualVideoDisplayWidth) / 2;
    const videoContentOffsetY = (videoRect.height - actualVideoDisplayHeight) / 2;

    // Render cursor
    const cursorCtx = cursorCanvas.getContext('2d');
    if (cursorCtx) {
      cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
      cursorCtx.save();
      cursorCtx.translate(videoContentOffsetX, videoContentOffsetY);
      renderCursor(
        cursorCanvas,
        metadata,
        videoCurrentTime,
        videoWidth,
        videoHeight,
        actualVideoDisplayWidth,
        actualVideoDisplayHeight
      );
      cursorCtx.restore();
    }

    // Render zoom
    const zoomCtx = zoomCanvas.getContext('2d');
    if (zoomCtx) {
      zoomCtx.clearRect(0, 0, zoomCanvas.width, zoomCanvas.height);
      zoomCtx.save();
      zoomCtx.translate(videoContentOffsetX, videoContentOffsetY);
      renderZoom(
        zoomCanvas,
        metadata,
        videoCurrentTime,
        videoWidth,
        videoHeight,
        actualVideoDisplayWidth,
        actualVideoDisplayHeight
      );
      zoomCtx.restore();
    }
  }, [metadata, videoRef, currentTime]);

  // Single effect handles both seeks and playback
  // currentTime is now updated by usePlayback (RAF during playback, immediate on seeks)
  useEffect(() => {
    if (!isPlaying) {
      resetCursorSmoothing();
    }
    renderPreview();
  }, [currentTime, isPlaying, renderPreview]);

  // Reset smoothing on video load
  useEffect(() => {
    resetCursorSmoothing();
  }, [videoPath]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const rect = video.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * video.duration;
    resetCursorSmoothing();
    seekTo(time);
  }, [videoRef, seekTo]);

  return (
    <div className="flex-1 flex flex-col bg-black relative">
      <div ref={wrapperRef} className="flex-1 flex items-center justify-center relative overflow-hidden">
        <video
          ref={videoRef}
          src={videoPath ? (videoPath.startsWith('file://') ? videoPath : `file://${videoPath}`) : undefined}
          className="max-w-full max-h-full block"
          onClick={handleSeek}
        />
        <canvas ref={cursorCanvasRef} className="absolute top-0 left-0 pointer-events-none" />
        <canvas ref={zoomCanvasRef} className="absolute top-0 left-0 pointer-events-none" />
      </div>
      <PlaybackControls />
    </div>
  );
}
