import React, { useState, useEffect } from 'react';
import { useElectronAPI } from '../../shared/hooks/useElectronAPI';

interface ProcessingProgressProps {
  isVisible: boolean;
}

export function ProcessingProgress({ isVisible }: ProcessingProgressProps) {
  const api = useElectronAPI();
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('Processing...');

  useEffect(() => {
    if (!api?.onProcessingProgress) return;

    api.onProcessingProgress((data) => {
      setPercent(data.percent);
      setMessage(data.message);
    });

    return () => {
      api.removeProcessingProgressListener?.();
    };
  }, [api]);

  if (!isVisible) return null;

  return (
    <div className="mt-4 p-4">
      <div className="h-5 bg-neutral-700 rounded-lg overflow-hidden mb-2.5">
        <div
          className="h-full bg-gradient-to-r from-neutral-600 to-neutral-500 rounded-lg
                     transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="block text-center text-sm text-[#e0e0e0] font-medium">
        {message} ({percent}%)
      </span>
    </div>
  );
}
