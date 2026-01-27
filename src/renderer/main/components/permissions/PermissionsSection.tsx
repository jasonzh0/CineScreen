import React from 'react';
import type { DetailedPermissionStatus, DetailedPermissionItem } from '../../../../types';
import { Card, CardTitle, Button } from '../../../shared/components';
import { PermissionCard } from './PermissionCard';

interface PermissionsSectionProps {
  permissions: DetailedPermissionStatus | null;
  allRequiredGranted: boolean;
  isChecking: boolean;
  onRequestPermission: (type: 'screen-recording' | 'accessibility' | 'microphone') => void;
  onCheckAgain: () => void;
}

export function PermissionsSection({
  permissions,
  allRequiredGranted,
  isChecking,
  onRequestPermission,
  onCheckAgain,
}: PermissionsSectionProps) {
  if (!permissions) {
    return (
      <Card>
        <CardTitle>Permissions</CardTitle>
        <p className="text-sm text-[#b0b0b0]">Checking permissions...</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Permissions</CardTitle>
      <p className="text-xs text-[#808080] mb-4 leading-relaxed">
        CineScreen needs these permissions to capture your screen and track cursor movements.
      </p>

      <PermissionCard
        type="screen-recording"
        status={permissions.screenRecording}
        onRequest={() => onRequestPermission('screen-recording')}
      />
      <PermissionCard
        type="accessibility"
        status={permissions.accessibility}
        onRequest={() => onRequestPermission('accessibility')}
      />
      <PermissionCard
        type="microphone"
        status={permissions.microphone}
        onRequest={() => onRequestPermission('microphone')}
        isOptional
      />

      {!allRequiredGranted && (
        <>
          <div className="flex gap-2.5 mt-4 pt-4 border-t border-white/[0.04]">
            <Button
              variant="secondary"
              onClick={onCheckAgain}
              disabled={isChecking}
            >
              {isChecking ? 'Checking...' : 'Check Again'}
            </Button>
          </div>
          <p className="text-xs text-[#808080] mt-3 p-2.5 bg-[#6aabdf]/10 rounded-md border-l-[3px] border-[#6aabdf]">
            After granting permissions in System Preferences, click "Check Again" to refresh the status.
          </p>
        </>
      )}
    </Card>
  );
}
