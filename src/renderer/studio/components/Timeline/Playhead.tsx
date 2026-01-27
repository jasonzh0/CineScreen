import React from 'react';

interface PlayheadProps {
  position: number; // in pixels
}

export function Playhead({ position }: PlayheadProps) {
  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-[#6aabdf] pointer-events-none z-10"
      style={{ left: `${position + 80}px` }} // +80 for label column offset
    >
      {/* Playhead handle */}
      <div
        className="absolute -left-[5px] top-0 w-[11px] h-[11px] bg-[#6aabdf]"
        style={{
          clipPath: 'polygon(50% 100%, 0 0, 100% 0)',
          borderRadius: '0 0 3px 3px',
        }}
      />
    </div>
  );
}
