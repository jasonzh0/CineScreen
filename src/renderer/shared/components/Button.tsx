import React from 'react';
import { cn } from '../utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'record' | 'permission';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const variantStyles = {
  primary: `
    bg-gradient-to-b from-neutral-600 to-neutral-700
    text-[#e0e0e0] border border-white/[0.08]
    shadow-[0_1px_2px_rgba(0,0,0,0.2)]
    hover:from-neutral-500 hover:to-neutral-600 hover:border-white/[0.12]
    hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]
    active:from-neutral-700 active:to-neutral-800
    active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]
  `,
  secondary: `
    bg-white/5 text-[#b0b0b0] border border-white/[0.08]
    hover:bg-white/[0.08] hover:text-[#e0e0e0] hover:border-white/[0.12]
  `,
  danger: `
    bg-gradient-to-b from-red-600 to-red-700 text-white
    border border-black/15 shadow-[0_1px_2px_rgba(0,0,0,0.2)]
    hover:from-red-500 hover:to-red-600 hover:shadow-[0_2px_8px_rgba(199,58,43,0.4)]
    active:from-red-700 active:to-red-800 active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]
  `,
  record: `
    bg-gradient-to-b from-red-500 to-red-600 text-white
    border border-black/15 shadow-[0_2px_8px_rgba(230,57,57,0.3)]
    hover:from-red-400 hover:to-red-500 hover:shadow-[0_4px_12px_rgba(230,57,57,0.4)]
    active:from-red-600 active:to-red-700
    disabled:from-neutral-600 disabled:to-neutral-700 disabled:shadow-none
  `,
  permission: `
    bg-[#6aabdf]/20 text-[#6aabdf] border border-[#6aabdf]/30
    hover:bg-[#6aabdf]/30 hover:border-[#6aabdf]/50
  `,
};

const sizeStyles = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'rounded-lg font-medium transition-all duration-150 ease-out',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'flex items-center justify-center gap-2',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
