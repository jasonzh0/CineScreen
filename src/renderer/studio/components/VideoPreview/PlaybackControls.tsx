import React from 'react';
import { useStudio } from '../../context/StudioContext';

export function PlaybackControls() {
  const {
    isPlaying,
    togglePlayPause,
    skipBackward,
    skipForward,
  } = useStudio();

  return (
    <div className="bg-[#141414] px-5 py-3.5 border-t border-white/[0.04] flex justify-center items-center gap-2">
      <button
        onClick={() => skipBackward()}
        className="playback-button"
        title="Skip backward"
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
          <path d="M11 18V6l-8.5 6 8.5 6zm.5-12l8.5 6-8.5 6V6z" fill="currentColor" />
        </svg>
      </button>

      <button
        onClick={togglePlayPause}
        className="w-11 h-11 rounded-full bg-neutral-200 text-neutral-900
                   flex items-center justify-center
                   hover:scale-105 hover:bg-white hover:shadow-[0_2px_12px_rgba(255,255,255,0.2)]
                   active:scale-95 transition-all duration-150"
        title="Play/Pause"
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
            <rect x="6" y="4" width="4" height="16" fill="currentColor" />
            <rect x="14" y="4" width="4" height="16" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px] ml-0.5">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        )}
      </button>

      <button
        onClick={() => skipForward()}
        className="playback-button"
        title="Skip forward"
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
          <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
