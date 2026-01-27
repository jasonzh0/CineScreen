import React from 'react';

interface TimelineRulerProps {
  scale: number; // pixels per second
  duration: number; // seconds
}

export function TimelineRuler({ scale, duration }: TimelineRulerProps) {
  const markers: { time: number; label: string }[] = [];

  // Determine appropriate interval based on scale
  let interval: number;
  if (scale >= 200) {
    interval = 1; // every second
  } else if (scale >= 100) {
    interval = 2; // every 2 seconds
  } else if (scale >= 50) {
    interval = 5; // every 5 seconds
  } else {
    interval = 10; // every 10 seconds
  }

  for (let t = 0; t <= duration; t += interval) {
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    markers.push({
      time: t,
      label: `${mins}:${secs.toString().padStart(2, '0')}`,
    });
  }

  return (
    <div className="absolute top-0 left-0 right-0 h-7 border-b border-white/[0.04] bg-[#161616]">
      {markers.map((marker) => (
        <div
          key={marker.time}
          className="absolute top-0 bottom-0 flex flex-col items-center"
          style={{ left: `${marker.time * scale + 80}px` }} // +80 for label column offset
        >
          <span className="text-[10px] text-[#666666] mt-1">{marker.label}</span>
          <div className="w-px flex-1 bg-white/10" />
        </div>
      ))}
    </div>
  );
}
