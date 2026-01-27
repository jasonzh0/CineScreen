import React from 'react';
import { cn } from '../utils/cn';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  valueDisplay?: string;
  className?: string;
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  valueDisplay,
  className,
}: SliderProps) {
  return (
    <div className={cn('w-full', className)}>
      {(label || valueDisplay) && (
        <div className="flex justify-between items-center mb-2">
          {label && (
            <label className="text-sm font-medium text-[#e0e0e0]">
              {label}
            </label>
          )}
          {valueDisplay && (
            <span className="text-xs font-medium text-[#6aabdf] bg-[#6aabdf]/10 px-2 py-0.5 rounded">
              {valueDisplay}
            </span>
          )}
        </div>
      )}
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full"
      />
    </div>
  );
}
