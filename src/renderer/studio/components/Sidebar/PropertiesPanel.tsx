import React from 'react';
import { useStudio } from '../../context/StudioContext';

export function PropertiesPanel() {
  const { metadata, updateMetadata } = useStudio();

  if (!metadata) return null;

  const cursorSize = metadata.cursor.config.size || 100;
  const motionBlurEnabled = metadata.cursor.config.motionBlur?.enabled || false;
  const motionBlurStrength = Math.round((metadata.cursor.config.motionBlur?.strength || 0.5) * 100);
  const zoomEnabled = metadata.zoom.config.enabled || false;
  const zoomLevel = metadata.zoom.config.level || 2.0;

  const handleCursorSizeChange = (value: number) => {
    updateMetadata(prev => ({
      ...prev,
      cursor: {
        ...prev.cursor,
        config: { ...prev.cursor.config, size: value },
      },
    }));
  };

  const handleMotionBlurEnabledChange = (enabled: boolean) => {
    updateMetadata(prev => ({
      ...prev,
      cursor: {
        ...prev.cursor,
        config: {
          ...prev.cursor.config,
          motionBlur: {
            enabled,
            strength: prev.cursor.config.motionBlur?.strength || 0.5,
          },
        },
      },
    }));
  };

  const handleMotionBlurStrengthChange = (value: number) => {
    updateMetadata(prev => ({
      ...prev,
      cursor: {
        ...prev.cursor,
        config: {
          ...prev.cursor.config,
          motionBlur: {
            enabled: prev.cursor.config.motionBlur?.enabled || false,
            strength: value / 100,
          },
        },
      },
    }));
  };

  const handleZoomEnabledChange = (enabled: boolean) => {
    updateMetadata(prev => ({
      ...prev,
      zoom: {
        ...prev.zoom,
        config: { ...prev.zoom.config, enabled },
      },
    }));
  };

  const handleZoomLevelChange = (value: number) => {
    updateMetadata(prev => ({
      ...prev,
      zoom: {
        ...prev.zoom,
        config: { ...prev.zoom.config, level: value },
      },
    }));
  };

  return (
    <div className="p-4 border-b border-white/[0.04]">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#666666] mb-3.5">
        Properties
      </h3>

      {/* Cursor Settings */}
      <div className="mb-5">
        <h4 className="text-xs font-medium text-[#808080] mb-3">Cursor Settings</h4>

        <div className="setting-item">
          <label>Size:</label>
          <input
            type="range"
            min="20"
            max="400"
            value={cursorSize}
            onChange={(e) => handleCursorSizeChange(parseInt(e.target.value))}
          />
          <span>{cursorSize}px</span>
        </div>

        <div className="setting-item">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={motionBlurEnabled}
              onChange={(e) => handleMotionBlurEnabledChange(e.target.checked)}
            />
            Motion Blur
          </label>
        </div>

        {motionBlurEnabled && (
          <div className="setting-item">
            <label>Blur Strength:</label>
            <input
              type="range"
              min="0"
              max="100"
              value={motionBlurStrength}
              onChange={(e) => handleMotionBlurStrengthChange(parseInt(e.target.value))}
            />
            <span>{motionBlurStrength}%</span>
          </div>
        )}
      </div>

      {/* Zoom Settings */}
      <div>
        <h4 className="text-xs font-medium text-[#808080] mb-3">Zoom Settings</h4>

        <div className="setting-item">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={zoomEnabled}
              onChange={(e) => handleZoomEnabledChange(e.target.checked)}
            />
            Enable Zoom
          </label>
        </div>

        {zoomEnabled && (
          <div className="setting-item">
            <label>Level:</label>
            <input
              type="range"
              min="1.5"
              max="3.0"
              step="0.1"
              value={zoomLevel}
              onChange={(e) => handleZoomLevelChange(parseFloat(e.target.value))}
            />
            <span>{zoomLevel.toFixed(1)}x</span>
          </div>
        )}
      </div>
    </div>
  );
}
