import React from 'react';

interface RecordButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function RecordButton({ onClick, disabled }: RecordButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Start Recording"
      className="relative w-10 h-10 rounded-full flex items-center justify-center
                 bg-gradient-to-b from-red-500 to-red-600 text-white
                 shadow-[0_2px_8px_rgba(230,57,57,0.4)]
                 hover:from-red-400 hover:to-red-500
                 hover:shadow-[0_4px_12px_rgba(230,57,57,0.5)]
                 active:from-red-600 active:to-red-700
                 active:scale-95
                 disabled:opacity-50 disabled:cursor-not-allowed
                 transition-all duration-150 ease-out
                 [-webkit-app-region:no-drag]"
    >
      {/* Record icon (filled circle) */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="5" />
      </svg>
    </button>
  );
}
