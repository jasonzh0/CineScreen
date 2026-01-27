import React from 'react';

interface ActionButtonProps {
  icon: 'restart' | 'cancel';
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger';
}

const icons = {
  restart: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 3V1L4 4l4 3V5c2.76 0 5 2.24 5 5s-2.24 5-5 5-5-2.24-5-5H1c0 3.87 3.13 7 7 7s7-3.13 7-7-3.13-7-7-7z" />
    </svg>
  ),
  cancel: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.5 3L3 4.5l3.5 3.5L3 11.5 4.5 13l3.5-3.5 3.5 3.5 1.5-1.5-3.5-3.5 3.5-3.5L11.5 3 8 6.5 4.5 3z" />
    </svg>
  ),
};

const titles = {
  restart: 'Restart Recording',
  cancel: 'Cancel Recording',
};

export function ActionButton({ icon, onClick, disabled, variant = 'default' }: ActionButtonProps) {
  const baseClasses = `
    w-8 h-8 rounded-lg flex items-center justify-center
    transition-all duration-150 ease-out
    active:scale-95
    disabled:opacity-50 disabled:cursor-not-allowed
    [-webkit-app-region:no-drag]
  `;

  const variantClasses = variant === 'danger'
    ? `
        bg-white/[0.08] text-white/70
        hover:bg-red-500/20 hover:text-red-400
        active:bg-red-500/15
      `
    : `
        bg-white/[0.08] text-white/70
        hover:bg-white/[0.15] hover:text-white/90
        active:bg-white/[0.1]
      `;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={titles[icon]}
      className={`${baseClasses} ${variantClasses}`}
    >
      {icons[icon]}
    </button>
  );
}
