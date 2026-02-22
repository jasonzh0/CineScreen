import React, { useCallback, useEffect, useRef, useState } from 'react';

interface TrimOverlayProps {
  trimStartMs: number;
  trimEndMs: number;
  durationMs: number;
  scale: number;
  onTrimChange: (startMs: number, endMs: number) => void;
}

export function TrimOverlay({ trimStartMs, trimEndMs, durationMs, scale, onTrimChange }: TrimOverlayProps) {
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Clamp to actual duration to handle metadata/video element timing differences
  const effectiveDurationMs = durationMs || trimEndMs;
  const effectiveTrimEndMs = Math.min(trimEndMs, effectiveDurationMs);

  const msToPixels = (ms: number) => (ms / 1000) * scale;

  const leftDimWidth = msToPixels(trimStartMs);
  const rightDimLeft = msToPixels(effectiveTrimEndMs);
  const rightDimWidth = msToPixels(effectiveDurationMs) - rightDimLeft;

  const clientXToMs = useCallback((clientX: number) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    return (x / scale) * 1000;
  }, [scale]);

  const handleMouseDown = useCallback((e: React.MouseEvent, handle: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(handle);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ms = clientXToMs(e.clientX);

      if (dragging === 'start') {
        const clamped = Math.max(0, Math.min(ms, effectiveTrimEndMs - 100));
        onTrimChange(clamped, effectiveTrimEndMs);
      } else {
        const clamped = Math.min(effectiveDurationMs, Math.max(ms, trimStartMs + 100));
        onTrimChange(trimStartMs, clamped);
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, trimStartMs, effectiveTrimEndMs, effectiveDurationMs, clientXToMs, onTrimChange]);

  return (
    <div
      ref={containerRef}
      className="absolute top-0 bottom-0 ml-20 pointer-events-none z-20"
      style={{ left: 0, width: `${msToPixels(effectiveDurationMs)}px` }}
    >
      {/* Left dimmed region */}
      {trimStartMs > 0 && (
        <div
          className="absolute top-0 bottom-0 left-0 bg-black/50 pointer-events-none"
          style={{ width: `${leftDimWidth}px` }}
        />
      )}

      {/* Right dimmed region */}
      {effectiveTrimEndMs < effectiveDurationMs && (
        <div
          className="absolute top-0 bottom-0 bg-black/50 pointer-events-none"
          style={{ left: `${rightDimLeft}px`, width: `${rightDimWidth}px` }}
        />
      )}

      {/* Start handle */}
      <div
        className="absolute top-0 bottom-0 w-2 bg-blue-400 cursor-col-resize pointer-events-auto
                   hover:bg-blue-300 transition-colors z-30"
        style={{ left: `${leftDimWidth - 4}px` }}
        onMouseDown={(e) => handleMouseDown(e, 'start')}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/80 rounded" />
      </div>

      {/* End handle */}
      <div
        className="absolute top-0 bottom-0 w-2 bg-blue-400 cursor-col-resize pointer-events-auto
                   hover:bg-blue-300 transition-colors z-30"
        style={{ left: `${rightDimLeft - 4}px` }}
        onMouseDown={(e) => handleMouseDown(e, 'end')}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/80 rounded" />
      </div>
    </div>
  );
}
