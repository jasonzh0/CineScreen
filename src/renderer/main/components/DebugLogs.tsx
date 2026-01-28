import React from 'react';
import { Button, Card, CardTitle } from '../../shared/components';
import { cn } from '../../shared/utils/cn';

interface DebugLogEntry {
  id: number;
  timestamp: string;
  message: string;
  level: 'info' | 'warning' | 'error';
}

interface DebugLogsProps {
  logs: DebugLogEntry[];
  autoScroll: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClear: () => void;
  onAutoScrollChange: (value: boolean) => void;
}

const levelColors = {
  info: 'text-teal-400',
  warning: 'text-yellow-300',
  error: 'text-red-400',
};

export function DebugLogs({
  logs,
  autoScroll,
  containerRef,
  onClear,
  onAutoScrollChange,
}: DebugLogsProps) {
  return (
    <Card>
      <div className="flex justify-between items-center mb-4">
        <CardTitle className="mb-0">Debug Logs</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onClear}>
            Clear
          </Button>
          <label className="flex items-center gap-1 text-xs text-[#808080] cursor-pointer ml-2">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => onAutoScrollChange(e.target.checked)}
              className="cursor-pointer"
            />
            <span className="select-none">Autoscroll</span>
          </label>
        </div>
      </div>

      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className="max-h-[400px] overflow-y-auto bg-neutral-900 rounded-md p-3
                   font-mono text-xs leading-relaxed"
      >
        {logs.map((entry) => (
          <div
            key={entry.id}
            className={cn('mb-1 break-words whitespace-pre-wrap', levelColors[entry.level])}
          >
            [{entry.timestamp}] {entry.message}
          </div>
        ))}
      </div>
    </Card>
  );
}
