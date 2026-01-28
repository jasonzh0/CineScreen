import React from 'react';

interface MenuButtonProps {
  onOpenSettings: () => void;
}

export function MenuButton({ onOpenSettings }: MenuButtonProps) {
  return (
    <button
      onClick={onOpenSettings}
      title="Open Settings"
      className="w-7 h-7 rounded-lg flex items-center justify-center
                 bg-white/[0.08] text-white/70
                 hover:bg-white/[0.15] hover:text-white/90
                 active:bg-white/[0.1] active:scale-95
                 transition-all duration-150 ease-out
                 [-webkit-app-region:no-drag]"
    >
      {/* Three dots icon (vertical) */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="3" r="1.5" />
        <circle cx="8" cy="8" r="1.5" />
        <circle cx="8" cy="13" r="1.5" />
      </svg>
    </button>
  );
}
