import React, { useEffect, useState } from 'react';
import { cn } from '../utils/cn';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
}

const typeStyles = {
  success: 'bg-green-500/95 border-green-500',
  warning: 'bg-orange-500/95 border-orange-500',
  error: 'bg-red-500/95 border-red-500',
  info: 'bg-blue-500/95 border-blue-500',
};

function Toast({ message, type = 'info', duration = 4000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setIsVisible(true));

    // Start exit animation before closing
    const exitTimer = setTimeout(() => {
      setIsLeaving(true);
    }, duration - 300);

    // Close after duration
    const closeTimer = setTimeout(() => {
      onClose();
    }, duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(closeTimer);
    };
  }, [duration, onClose]);

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg text-sm font-medium text-white',
        'shadow-[0_4px_12px_rgba(0,0,0,0.3)] border',
        'transition-all duration-300 ease-out',
        typeStyles[type],
        isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      )}
    >
      {message}
    </div>
  );
}

interface ToastContainerProps {
  toasts: Array<{ id: string; message: string; type: ToastType }>;
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed bottom-5 right-5 z-[10000] flex flex-col gap-2.5 max-w-[350px]">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => onRemove(toast.id)}
        />
      ))}
    </div>
  );
}
