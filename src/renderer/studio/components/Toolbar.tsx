import React from 'react';
import { useStudio } from '../context/StudioContext';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function Toolbar() {
  const {
    saveMetadata,
    reloadMetadata,
    exportVideo,
    isExporting,
    currentTime,
    duration,
    showToast,
  } = useStudio();

  const handleSave = async () => {
    const success = await saveMetadata();
    showToast(success ? 'Saved' : 'Failed to save', success ? 'success' : 'error');
  };

  const handleLoad = async () => {
    if (!confirm('Reload from file? Any unsaved changes will be lost.')) return;
    const success = await reloadMetadata();
    showToast(success ? 'Reloaded' : 'Failed to reload', success ? 'success' : 'error');
  };

  const handleExport = async () => {
    const result = await exportVideo();
    if (result.success) {
      alert(`Video exported successfully to:\n${result.outputPath}`);
    } else {
      alert(`Export failed: ${result.error}`);
    }
  };

  return (
    <div className="bg-[#161616] px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <button onClick={handleSave} className="toolbar-button">
          Save
        </button>
        <button onClick={handleLoad} className="toolbar-button">
          Load
        </button>
        <button onClick={handleExport} disabled={isExporting} className="toolbar-button">
          {isExporting ? 'Exporting...' : 'Export Video'}
        </button>
      </div>
      <div className="ml-auto text-xs text-[#666666] font-mono tabular-nums">
        {formatTime(currentTime / 1000)} / {formatTime(duration)}
      </div>
    </div>
  );
}
