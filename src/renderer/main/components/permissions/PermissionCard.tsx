import React from 'react';
import type { PermissionState, DetailedPermissionItem } from '../../../../types';
import { Button } from '../../../shared/components';
import { cn } from '../../../shared/utils/cn';
import {
  getPermissionStatusText,
  getPermissionButtonText,
  getPermissionName,
} from '../../hooks/usePermissions';

interface PermissionCardProps {
  type: 'screen-recording' | 'accessibility' | 'microphone';
  status: DetailedPermissionItem;
  onRequest: () => void;
  isOptional?: boolean;
}

function PermissionStatus({ state }: { state: PermissionState }) {
  const statusClasses = {
    granted: 'bg-[#6fcf73]/15 text-[#6fcf73]',
    denied: 'bg-[#f47066]/15 text-[#f47066]',
    'not-determined': 'bg-[#e0a800]/15 text-[#e0a800]',
    restricted: 'bg-[#f47066]/15 text-[#f47066]',
    unavailable: 'bg-[#666666]/15 text-[#666666]',
  };

  return (
    <span
      className={cn(
        'px-2.5 py-1 rounded text-xs uppercase font-medium tracking-wide',
        statusClasses[state] || statusClasses.denied
      )}
    >
      {getPermissionStatusText(state)}
    </span>
  );
}

const descriptions = {
  'screen-recording': 'Required to capture screen content',
  accessibility: 'Required to track cursor position',
  microphone: 'Only needed if you want to record audio',
};

export function PermissionCard({ type, status, onRequest, isOptional }: PermissionCardProps) {
  const showButton = status.state !== 'granted';
  const showHelp = status.state === 'denied';

  return (
    <div className="py-3 border-b border-white/[0.04] last:border-0 first:pt-0 last:pb-0">
      <div className="flex justify-between items-center text-sm text-[#b0b0b0]">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-[#e0e0e0]">
            {getPermissionName(type)}
            {isOptional && (
              <span className="text-[10px] text-[#808080] ml-1">(Optional)</span>
            )}
          </span>
          <span className="text-xs text-[#666666]">{descriptions[type]}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <PermissionStatus state={status.state} />
          {showButton && (
            <Button
              variant="permission"
              size="sm"
              onClick={onRequest}
            >
              {getPermissionButtonText(status.state, status.canRequest)}
            </Button>
          )}
        </div>
      </div>

      {showHelp && (
        <div className="mt-2 p-3 text-xs text-[#b0b0b0] bg-[#e0a800]/[0.08] border-l-[3px] border-[#e0a800] rounded-r-md">
          <p className="font-medium text-[#e0e0e0] mb-2">
            To enable {getPermissionName(type)}:
          </p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Click "Open Settings" to open System Preferences</li>
            <li>Find CineScreen in the list and check the box</li>
            <li>Return to CineScreen after granting permission</li>
          </ol>
        </div>
      )}
    </div>
  );
}
