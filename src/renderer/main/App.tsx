import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { TabNav, RecordingIcon, EditingIcon, PermissionsIcon, LogsIcon } from './components/TabNav';
import { RecordingTab } from './components/tabs/RecordingTab';
import { EditingTab } from './components/tabs/EditingTab';
import { PermissionsTab } from './components/tabs/PermissionsTab';
import { LogsTab } from './components/tabs/LogsTab';
import { RecordingControls } from './components/RecordingControls';
import { ToastContainer } from '../shared/components';
import { usePermissions, getPermissionName } from './hooks/usePermissions';
import { useDebugLogs } from './hooks/useDebugLogs';
import { useToast } from './hooks/useToast';

const tabs = [
  { id: 'recording', label: 'Recording', icon: <RecordingIcon /> },
  { id: 'editing', label: 'Editing', icon: <EditingIcon /> },
  { id: 'permissions', label: 'Permissions', icon: <PermissionsIcon /> },
  { id: 'logs', label: 'Logs', icon: <LogsIcon /> },
];

export function App() {
  const [activeTab, setActiveTab] = useState('recording');

  const {
    permissions,
    isChecking,
    allRequiredGranted,
    checkPermissions,
    requestPermission,
  } = usePermissions();

  const debugLogs = useDebugLogs();
  const { toasts, showToast, removeToast } = useToast();

  const handleRequestPermission = useCallback(async (type: 'screen-recording' | 'accessibility' | 'microphone') => {
    const result = await requestPermission(type);
    if (!result) return;

    switch (result.action) {
      case 'already-granted':
        showToast(`${getPermissionName(type)} permission is already granted`, 'success');
        break;
      case 'dialog-shown':
        if (result.success) {
          showToast(`${getPermissionName(type)} permission granted!`, 'success');
        } else {
          showToast(`${getPermissionName(type)} permission was denied`, 'warning');
        }
        break;
      case 'opened-preferences':
        showToast('System Preferences opened. Grant permission and click "Check Again"', 'info');
        break;
      case 'error':
        showToast(`Error: ${result.errorMessage || 'Failed to request permission'}`, 'error');
        break;
    }
  }, [requestPermission, showToast]);

  const handleCheckAgain = useCallback(async () => {
    await checkPermissions();
    showToast('Permission status refreshed', 'info');
  }, [checkPermissions, showToast]);

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-[#e0e0e0] p-5">
      <div className="max-w-[600px] mx-auto p-8">
        <Header />

        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <div className="mb-5">
          {activeTab === 'recording' && <RecordingTab />}
          {activeTab === 'editing' && <EditingTab />}
          {activeTab === 'permissions' && (
            <PermissionsTab
              permissions={permissions}
              allRequiredGranted={allRequiredGranted}
              isChecking={isChecking}
              onRequestPermission={handleRequestPermission}
              onCheckAgain={handleCheckAgain}
            />
          )}
          {activeTab === 'logs' && (
            <LogsTab
              logs={debugLogs.logs}
              autoScroll={debugLogs.autoScroll}
              containerRef={debugLogs.containerRef}
              onClear={debugLogs.clearLogs}
              onAutoScrollChange={debugLogs.setAutoScroll}
            />
          )}
        </div>

        <RecordingControls showToast={showToast} />

        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </div>
  );
}
