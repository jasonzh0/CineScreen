import React from 'react';

interface TimerDisplayProps {
  elapsedMs: number;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function TimerDisplay({ elapsedMs }: TimerDisplayProps) {
  return (
    <div
      className="text-lg font-semibold text-white min-w-[60px] text-center
                 tracking-wide tabular-nums"
    >
      {formatTime(elapsedMs)}
    </div>
  );
}
