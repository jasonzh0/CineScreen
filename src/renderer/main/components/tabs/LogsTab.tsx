import React from 'react';
import { DebugLogs } from '../DebugLogs';

interface LogsTabProps {
  logs: Array<{ id: number; timestamp: string; message: string; level: 'info' | 'warning' | 'error' }>;
  autoScroll: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClear: () => void;
  onAutoScrollChange: (value: boolean) => void;
}

export function LogsTab({
  logs,
  autoScroll,
  containerRef,
  onClear,
  onAutoScrollChange,
}: LogsTabProps) {
  return (
    <div className="space-y-5">
      <DebugLogs
        logs={logs}
        autoScroll={autoScroll}
        containerRef={containerRef}
        onClear={onClear}
        onAutoScrollChange={onAutoScrollChange}
      />
    </div>
  );
}
