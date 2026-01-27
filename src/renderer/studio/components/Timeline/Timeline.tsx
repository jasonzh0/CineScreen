import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useStudio } from '../../context/StudioContext';
import { TimelineRuler } from './TimelineRuler';
import { Playhead } from './Playhead';

export function Timeline() {
  const {
    metadata,
    currentTime,
    duration,
    seekTo,
    selectedZoomSection,
    setSelectedZoomSection,
    updateZoomSection,
  } = useStudio();

  const timelineRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(100); // pixels per second

  const durationMs = duration * 1000;
  const zoomSections = metadata?.zoom.sections || [];

  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (!timelineRef.current || !duration) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const time = (x / scale); // seconds
    seekTo(Math.max(0, Math.min(time, duration)));
  }, [duration, scale, seekTo]);

  const handleZoomIn = () => setScale(s => Math.min(s * 1.5, 500));
  const handleZoomOut = () => setScale(s => Math.max(s / 1.5, 20));

  // Playhead position in pixels
  const playheadPosition = (currentTime / 1000) * scale;

  return (
    <div className="bg-[#141414] border-t border-white/[0.06] h-[200px] flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/[0.04] bg-[#161616] flex justify-between items-center">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#666666]">
          Timeline
        </span>
        <div className="flex gap-1">
          <button onClick={handleZoomOut} className="toolbar-button px-2.5 py-1 text-sm">
            -
          </button>
          <button onClick={handleZoomIn} className="toolbar-button px-2.5 py-1 text-sm">
            +
          </button>
        </div>
      </div>

      {/* Timeline content */}
      <div
        ref={timelineRef}
        className="flex-1 relative overflow-x-auto overflow-y-hidden cursor-pointer"
        onClick={handleTimelineClick}
      >
        <div style={{ width: `${Math.max(duration * scale, 100)}px`, position: 'relative', height: '100%' }}>
          <TimelineRuler scale={scale} duration={duration} />

          {/* Track rows */}
          <div className="absolute top-7 left-0 right-0 bottom-0 flex flex-col">
            {/* Video track */}
            <div className="flex-1 relative border-b border-white/[0.04] min-h-[60px] bg-neutral-800/50">
              <div className="absolute left-0 top-0 bottom-0 w-20 bg-[#161616] border-r border-white/[0.04]
                             flex items-center pl-4 text-xs font-medium text-[#666666] z-10">
                Video
              </div>
              <div
                className="absolute top-2 bottom-2 ml-20 bg-video-bg border-l-[3px] border-video-border rounded"
                style={{ left: 0, width: `${duration * scale}px` }}
              >
                <span className="ml-3 text-xs font-medium text-white/70">Recording</span>
              </div>
            </div>

            {/* Zoom track */}
            <div className="flex-1 relative min-h-[60px] bg-neutral-800/50">
              <div className="absolute left-0 top-0 bottom-0 w-20 bg-[#161616] border-r border-white/[0.04]
                             flex items-center pl-4 text-xs font-medium text-[#666666] z-10">
                Zoom
              </div>
              <div className="absolute top-0 bottom-0 left-20 right-0">
                {zoomSections.map((section) => (
                  <ZoomSectionElement
                    key={section.startTime}
                    section={section}
                    scale={scale}
                    isSelected={selectedZoomSection === section.startTime}
                    onClick={() => setSelectedZoomSection(section.startTime)}
                    onUpdate={(updates) => updateZoomSection(section.startTime, updates)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Playhead */}
          <Playhead position={playheadPosition} />
        </div>
      </div>
    </div>
  );
}

interface ZoomSectionElementProps {
  section: { startTime: number; endTime: number; scale: number };
  scale: number;
  isSelected: boolean;
  onClick: () => void;
  onUpdate: (updates: { startTime?: number; endTime?: number }) => void;
}

function ZoomSectionElement({ section, scale, isSelected, onClick, onUpdate }: ZoomSectionElementProps) {
  const left = (section.startTime / 1000) * scale;
  const width = ((section.endTime - section.startTime) / 1000) * scale;

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`absolute top-2 bottom-2 cursor-move flex items-center justify-center
                 text-xs font-medium text-white/70 select-none transition-all duration-150
                 bg-zoom-bg border-l-[3px] border-r-[3px] border-zoom-border rounded
                 hover:bg-zoom-bg/40
                 ${isSelected ? 'ring-2 ring-zoom-border/40 bg-zoom-bg/40' : ''}`}
      style={{ left: `${left}px`, width: `${width}px` }}
    >
      {section.scale.toFixed(1)}x
    </div>
  );
}
