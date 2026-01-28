import React from 'react';
import type { DetailedPermissionStatus } from '../../../../types';
import { PermissionsSection } from '../permissions/PermissionsSection';

interface PermissionsTabProps {
  permissions: DetailedPermissionStatus | null;
  allRequiredGranted: boolean;
  isChecking: boolean;
  onRequestPermission: (type: 'screen-recording' | 'accessibility' | 'microphone') => void;
  onCheckAgain: () => void;
}

export function PermissionsTab({
  permissions,
  allRequiredGranted,
  isChecking,
  onRequestPermission,
  onCheckAgain,
}: PermissionsTabProps) {
  return (
    <div className="space-y-5">
      <PermissionsSection
        permissions={permissions}
        allRequiredGranted={allRequiredGranted}
        isChecking={isChecking}
        onRequestPermission={onRequestPermission}
        onCheckAgain={onCheckAgain}
      />
    </div>
  );
}
