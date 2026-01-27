import React, { useState } from 'react';
import { Slider, Select, Toggle } from '../../../shared/components';
import { SettingsGroup } from '../settings/SettingsGroup';

const cursorStyleOptions = [
  { value: 'arrow', label: 'Arrow' },
  { value: 'pointer', label: 'Pointer' },
  { value: 'crosshair', label: 'Crosshair' },
];

const zoomAnimationOptions = [
  { value: 'slow', label: 'Slow' },
  { value: 'mellow', label: 'Mellow' },
  { value: 'quick', label: 'Quick' },
  { value: 'rapid', label: 'Rapid' },
];

export function EditingTab() {
  // Cursor settings
  const [cursorSize, setCursorSize] = useState(32);
  const [cursorShape, setCursorShape] = useState('arrow');

  // Zoom settings
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(2.0);
  const [zoomAnimation, setZoomAnimation] = useState('mellow');

  // Click effects
  const [clickCirclesEnabled, setClickCirclesEnabled] = useState(true);
  const [clickCircleColor, setClickCircleColor] = useState('#ffffff');

  return (
    <div className="space-y-5">
      {/* Cursor Settings */}
      <SettingsGroup title="Cursor">
        <Slider
          label="Cursor Size"
          value={cursorSize}
          onChange={setCursorSize}
          min={16}
          max={64}
          step={4}
          valueDisplay={`${cursorSize}px`}
        />
        <div className="space-y-2">
          <label className="text-sm font-medium text-[#e0e0e0]">
            Cursor Style
          </label>
          <Select
            options={cursorStyleOptions}
            value={cursorShape}
            onChange={setCursorShape}
          />
        </div>
      </SettingsGroup>

      {/* Zoom Settings */}
      <SettingsGroup title="Auto Zoom">
        <Toggle
          checked={zoomEnabled}
          onChange={setZoomEnabled}
          label="Enable zoom on click"
        />
        <div className={zoomEnabled ? 'opacity-100' : 'opacity-50'}>
          <Slider
            label="Zoom Level"
            value={zoomLevel}
            onChange={setZoomLevel}
            min={1.5}
            max={3}
            step={0.1}
            valueDisplay={`${zoomLevel.toFixed(1)}x`}
          />
        </div>
        <div className={`space-y-2 ${zoomEnabled ? 'opacity-100' : 'opacity-50'}`}>
          <label className="text-sm font-medium text-[#e0e0e0]">
            Animation Style
          </label>
          <Select
            options={zoomAnimationOptions}
            value={zoomAnimation}
            onChange={setZoomAnimation}
          />
        </div>
      </SettingsGroup>

      {/* Click Effects */}
      <SettingsGroup title="Click Effects">
        <Toggle
          checked={clickCirclesEnabled}
          onChange={setClickCirclesEnabled}
          label="Show click circles"
        />
        <div className={`flex items-center justify-between ${clickCirclesEnabled ? 'opacity-100' : 'opacity-50'}`}>
          <label className="text-sm font-medium text-[#e0e0e0]">
            Circle Color
          </label>
          <input
            type="color"
            value={clickCircleColor}
            onChange={(e) => setClickCircleColor(e.target.value)}
            className="w-12 h-8"
          />
        </div>
      </SettingsGroup>

      <p className="text-xs text-[#666666] leading-relaxed p-3 bg-[#6aabdf]/5 rounded-lg border-l-[3px] border-[#6aabdf]/30">
        These settings are applied when you export in Studio. Open an existing recording in Studio to preview and adjust these settings in real-time.
      </p>
    </div>
  );
}
