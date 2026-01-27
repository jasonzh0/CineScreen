import React from 'react';
import { useStudio } from '../../context/StudioContext';

function formatTime(ms: number): string {
  const seconds = ms / 1000;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ZoomSectionList() {
  const {
    metadata,
    currentTime,
    duration,
    seekTo,
    addZoomSection,
    removeZoomSection,
    selectedZoomSection,
    setSelectedZoomSection,
    showToast,
  } = useStudio();

  const zoomSections = metadata?.zoom.sections || [];
  const zoomLevel = metadata?.zoom.config.level || 2.0;

  const handleAddSection = () => {
    if (!metadata) return;

    const currentTimeMs = currentTime;
    const videoDurationMs = duration * 1000;

    const sectionDuration = 2000; // 2 seconds
    const startTime = Math.max(0, currentTimeMs - sectionDuration / 2);
    const endTime = Math.min(videoDurationMs, startTime + sectionDuration);

    const centerX = metadata.video.width / 2;
    const centerY = metadata.video.height / 2;

    addZoomSection(startTime, endTime, zoomLevel, centerX, centerY);
    showToast('Zoom section added');
  };

  const handleSuggest = () => {
    // Simplified suggestion - just add a section at current position
    showToast('Suggest feature coming soon', 'error');
  };

  const handleSectionClick = (startTime: number) => {
    setSelectedZoomSection(startTime);
    seekTo(startTime / 1000);
  };

  const handleDeleteSection = (e: React.MouseEvent, startTime: number) => {
    e.stopPropagation();
    removeZoomSection(startTime);
    showToast('Zoom section removed');
  };

  return (
    <div className="p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#666666] mb-3.5">
        Zoom Sections
      </h3>

      <div className="flex gap-2 mb-3">
        <button onClick={handleAddSection} className="toolbar-button flex-1">
          + Add
        </button>
        <button onClick={handleSuggest} className="toolbar-button flex-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mr-1">
            <path
              d="M12 2L13.09 8.26L19 7L14.74 11.27L21 12L14.74 12.73L19 17L13.09 15.74L12 22L10.91 15.74L5 17L9.26 12.73L3 12L9.26 11.27L5 7L10.91 8.26L12 2Z"
              fill="currentColor"
            />
          </svg>
          Suggest
        </button>
      </div>

      <div className="space-y-2">
        {zoomSections.length === 0 ? (
          <p className="text-xs text-[#666666] text-center py-4">
            No zoom sections yet
          </p>
        ) : (
          zoomSections.map((section) => (
            <div
              key={section.startTime}
              onClick={() => handleSectionClick(section.startTime)}
              className={`p-2.5 rounded-md cursor-pointer transition-colors text-xs
                         ${selectedZoomSection === section.startTime
                           ? 'bg-zoom-bg border border-zoom-border'
                           : 'bg-white/[0.04] hover:bg-white/[0.06]'
                         }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-[#b0b0b0]">
                  {formatTime(section.startTime)} - {formatTime(section.endTime)}
                </span>
                <button
                  onClick={(e) => handleDeleteSection(e, section.startTime)}
                  className="text-[#666666] hover:text-red-400 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4.5 3L3 4.5l3.5 3.5L3 11.5 4.5 13l3.5-3.5 3.5 3.5 1.5-1.5-3.5-3.5 3.5-3.5L11.5 3 8 6.5 4.5 3z" />
                  </svg>
                </button>
              </div>
              <div className="text-[#808080] mt-1">
                {section.scale.toFixed(1)}x zoom
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
