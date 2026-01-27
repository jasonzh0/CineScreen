import React from 'react';
import { cn } from '../utils/cn';

interface SelectOption {
  value: string | number;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[];
  value: string | number;
  onChange: (value: string) => void;
  label?: string;
}

export function Select({ options, value, onChange, label, className, ...props }: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'w-full px-3 py-2.5 bg-black/20 border border-white/[0.08] rounded-lg',
        'text-sm text-[#e0e0e0] cursor-pointer',
        'transition-all duration-150 ease-out appearance-none',
        'pr-10', // Space for dropdown arrow
        'hover:border-white/[0.15]',
        'focus:outline-none focus:border-[#6aabdf]/50',
        className
      )}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
