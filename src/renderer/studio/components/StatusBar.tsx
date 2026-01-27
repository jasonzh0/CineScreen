import React from 'react';
import { useStudio } from '../context/StudioContext';

export function StatusBar() {
  const { isLoading, error, isExporting, exportProgress, exportMessage } = useStudio();

  let statusText = 'Ready';
  if (isLoading) statusText = 'Loading...';
  if (error) statusText = `Error: ${error}`;
  if (isExporting) statusText = exportMessage || 'Exporting...';

  return (
    <div className="bg-[#161616] px-5 py-2.5 border-t border-white/[0.04] text-xs text-[#666666]">
      <span>{statusText}</span>

      {isExporting && (
        <div className="mt-2">
          <div className="h-[3px] bg-white/[0.08] rounded overflow-hidden mb-1.5">
            <div
              className="h-full bg-[#6aabdf] transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(0, Math.min(100, exportProgress))}%` }}
            />
          </div>
          <span className="text-[#808080]">{Math.round(exportProgress)}%</span>
        </div>
      )}
    </div>
  );
}
