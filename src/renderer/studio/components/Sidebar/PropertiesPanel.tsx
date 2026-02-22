import React from 'react';
import { useStudio } from '../../context/StudioContext';
import {
  CLICK_CIRCLE_DEFAULT_SIZE,
  CLICK_CIRCLE_DEFAULT_COLOR,
  DEFAULT_EFFECTS,
} from '../../../../utils/constants';

export function PropertiesPanel() {
  const { metadata, updateMetadata } = useStudio();

  if (!metadata) return null;

  const cursorSize = metadata.cursor.config.size || 100;
  const motionBlurEnabled = metadata.cursor.config.motionBlur?.enabled || false;
  const motionBlurStrength = Math.round((metadata.cursor.config.motionBlur?.strength || 0.5) * 100);
  const zoomEnabled = metadata.zoom.config.enabled || false;
  const zoomLevel = metadata.zoom.config.level || 2.0;
  const clickCirclesEnabled = metadata.effects?.clickCircles?.enabled ?? false;
  const clickCirclesColor = metadata.effects?.clickCircles?.color ?? CLICK_CIRCLE_DEFAULT_COLOR;
  const clickCirclesSize = metadata.effects?.clickCircles?.size ?? CLICK_CIRCLE_DEFAULT_SIZE;

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

  const handleClickCirclesEnabledChange = (enabled: boolean) => {
    updateMetadata(prev => {
      const effects = { ...DEFAULT_EFFECTS, ...prev.effects };
      return {
        ...prev,
        effects: {
          ...effects,
          clickCircles: { ...effects.clickCircles, enabled },
        },
      };
    });
  };

  const handleClickCirclesColorChange = (color: string) => {
    updateMetadata(prev => {
      const effects = { ...DEFAULT_EFFECTS, ...prev.effects };
      return {
        ...prev,
        effects: {
          ...effects,
          clickCircles: { ...effects.clickCircles, color },
        },
      };
    });
  };

  const handleClickCirclesSizeChange = (size: number) => {
    updateMetadata(prev => {
      const effects = { ...DEFAULT_EFFECTS, ...prev.effects };
      return {
        ...prev,
        effects: {
          ...effects,
          clickCircles: { ...effects.clickCircles, size },
        },
      };
    });
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

      {/* Click Effects */}
      <div className="mt-5">
        <h4 className="text-xs font-medium text-[#808080] mb-3">Click Effects</h4>

        <div className="setting-item">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={clickCirclesEnabled}
              onChange={(e) => handleClickCirclesEnabledChange(e.target.checked)}
            />
            Click Circles
          </label>
        </div>

        {clickCirclesEnabled && (
          <>
            <div className="setting-item">
              <label>Color:</label>
              <input
                type="color"
                value={clickCirclesColor}
                onChange={(e) => handleClickCirclesColorChange(e.target.value)}
              />
            </div>

            <div className="setting-item">
              <label>Size:</label>
              <input
                type="range"
                min="20"
                max="80"
                value={clickCirclesSize}
                onChange={(e) => handleClickCirclesSizeChange(parseInt(e.target.value))}
              />
              <span>{clickCirclesSize}px</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
