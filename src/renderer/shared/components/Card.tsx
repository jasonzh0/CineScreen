import React from 'react';
import { cn } from '../utils/cn';

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        'p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]',
        className
      )}
    >
      {children}
    </div>
  );
}

interface CardTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function CardTitle({ children, className }: CardTitleProps) {
  return (
    <h3
      className={cn(
        'text-xs font-semibold uppercase tracking-wider text-[#666666] mb-3',
        className
      )}
    >
      {children}
    </h3>
  );
}
