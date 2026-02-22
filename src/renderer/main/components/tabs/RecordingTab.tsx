import React, { useState, useCallback, useEffect } from 'react';
import { Button, Select } from '../../../shared/components';
import { SettingsGroup } from '../settings/SettingsGroup';
import { useElectronAPI } from '../../../shared/hooks/useElectronAPI';

const frameRateOptions = [
  { value: '30', label: '30 fps' },
  { value: '60', label: '60 fps' },
];

export function RecordingTab() {
  const api = useElectronAPI();
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [frameRate, setFrameRate] = useState('60');

  // Load saved config on mount
  useEffect(() => {
    if (!api?.getUserConfig) return;
    api.getUserConfig().then((config) => {
      if (config.outputDir) setOutputPath(config.outputDir as string);
      if (config.frameRate) setFrameRate(config.frameRate as string);
    });
  }, [api]);

  const handleSelectPath = useCallback(async () => {
    if (!api?.selectOutputPath) return;
    const path = await api.selectOutputPath();
    if (path) {
      setOutputPath(path);
    }
  }, [api]);

  const handleFrameRate = useCallback(
    (value: string) => {
      setFrameRate(value);
      api?.setUserConfig?.({ frameRate: value });
    },
    [api]
  );

  return (
    <div className="space-y-5">
      {/* Output Settings */}
      <SettingsGroup title="Output">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-[#e0e0e0]">
              Save Location
            </label>
          </div>
          <div className="flex gap-2.5">
            <input
              type="text"
              value={outputPath || ''}
              readOnly
              placeholder="Select output location..."
              className="flex-1 px-3 py-2.5 bg-black/20 border border-white/[0.08] rounded-md
                         text-sm text-[#b0b0b0] placeholder:text-[#666666]
                         focus:outline-none focus:border-white/[0.15]"
            />
            <Button variant="secondary" onClick={handleSelectPath}>
              Browse
            </Button>
          </div>
        </div>
      </SettingsGroup>

      {/* Quality Settings */}
      <SettingsGroup title="Quality">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-[#e0e0e0]">
              Frame Rate
            </label>
            <span className="text-xs font-medium text-[#6aabdf] bg-[#6aabdf]/10 px-2 py-0.5 rounded">
              {frameRate} fps
            </span>
          </div>
          <Select
            options={frameRateOptions}
            value={frameRate}
            onChange={handleFrameRate}
          />
        </div>
      </SettingsGroup>
    </div>
  );
}
