import { useState, useEffect, useCallback, useRef } from 'react';
import type { DetailedPermissionStatus, PermissionState } from '../../../types';
import { useElectronAPI } from '../../shared/hooks/useElectronAPI';

const POLL_INTERVAL = 1500;

export function usePermissions() {
  const api = useElectronAPI();
  const [permissions, setPermissions] = useState<DetailedPermissionStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkPermissions = useCallback(async () => {
    if (!api?.getDetailedPermissions) return;

    setIsChecking(true);
    try {
      const detailed = await api.getDetailedPermissions();
      setPermissions(detailed);
      return detailed;
    } catch (error) {
      console.error('Error checking permissions:', error);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, [api]);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(() => {
      checkPermissions();
    }, POLL_INTERVAL);
  }, [checkPermissions]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const requestPermission = useCallback(async (type: 'screen-recording' | 'accessibility' | 'microphone') => {
    if (!api?.requestPermission) return null;

    try {
      const result = await api.requestPermission(type);
      await checkPermissions();
      return result;
    } catch (error) {
      console.error(`Error requesting ${type} permission:`, error);
      return null;
    }
  }, [api, checkPermissions]);

  // Check if all required permissions are granted (microphone is optional)
  const allRequiredGranted = permissions
    ? permissions.screenRecording.state === 'granted' && permissions.accessibility.state === 'granted'
    : false;

  // Initial check and polling setup
  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  // Start/stop polling based on permission state
  useEffect(() => {
    if (!allRequiredGranted) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => stopPolling();
  }, [allRequiredGranted, startPolling, stopPolling]);

  return {
    permissions,
    isChecking,
    allRequiredGranted,
    checkPermissions,
    requestPermission,
  };
}

// Helper functions for permission UI
export function getPermissionStatusText(state: PermissionState): string {
  switch (state) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied';
    case 'not-determined':
      return 'Not Set';
    case 'restricted':
      return 'Restricted';
    case 'unavailable':
      return 'Unavailable';
    default:
      return 'Unknown';
  }
}

function getPermissionStatusClass(state: PermissionState): string {
  switch (state) {
    case 'granted':
      return 'granted';
    case 'denied':
    case 'restricted':
      return 'denied';
    case 'not-determined':
      return 'pending';
    default:
      return 'denied';
  }
}

export function getPermissionButtonText(state: PermissionState, canRequest: boolean): string {
  if (state === 'granted') {
    return 'Granted';
  }
  if (canRequest) {
    return 'Grant Access';
  }
  return 'Open Settings';
}

export function getPermissionName(type: 'screen-recording' | 'accessibility' | 'microphone'): string {
  switch (type) {
    case 'screen-recording':
      return 'Screen Recording';
    case 'accessibility':
      return 'Accessibility';
    case 'microphone':
      return 'Microphone';
  }
}
