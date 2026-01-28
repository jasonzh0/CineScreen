import React, { useState, useRef, useEffect } from 'react';

interface MenuButtonProps {
  onOpenSettings: () => void;
}

export function MenuButton({ onOpenSettings }: MenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleOpenSettings = () => {
    setIsOpen(false);
    onOpenSettings();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        title="Menu"
        className="w-8 h-8 rounded-lg flex items-center justify-center
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

      {isOpen && (
        <div
          ref={menuRef}
          className="absolute bottom-full mb-2 right-0 min-w-[140px]
                     bg-neutral-800/95 backdrop-blur-xl
                     rounded-lg border border-white/10
                     shadow-[0_4px_24px_rgba(0,0,0,0.4)]
                     overflow-hidden
                     [-webkit-app-region:no-drag]"
        >
          <button
            onClick={handleOpenSettings}
            className="w-full px-3 py-2 text-left text-sm text-white/90
                       hover:bg-white/[0.1]
                       transition-colors duration-100"
          >
            Open Settings
          </button>
        </div>
      )}
    </div>
  );
}
