import { useState, useEffect, useCallback, useRef } from 'react';
import { useElectronAPI } from '../../shared/hooks/useElectronAPI';

interface DebugLogEntry {
  id: number;
  timestamp: string;
  message: string;
  level: 'info' | 'warning' | 'error';
}

const MAX_LOG_ENTRIES = 500;
let logId = 0;

export function useDebugLogs() {
  const api = useElectronAPI();
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((message: string) => {
    const level = message.toLowerCase().includes('error')
      ? 'error'
      : message.toLowerCase().includes('warn')
        ? 'warning'
        : 'info';

    const entry: DebugLogEntry = {
      id: ++logId,
      timestamp: new Date().toLocaleTimeString(),
      message,
      level,
    };

    setLogs((prev) => {
      const newLogs = [...prev, entry];
      if (newLogs.length > MAX_LOG_ENTRIES) {
        return newLogs.slice(-MAX_LOG_ENTRIES);
      }
      return newLogs;
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    addLog('Debug logs cleared');
  }, [addLog]);

  const toggleVisible = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, []);

  // Set up debug log listener
  useEffect(() => {
    if (!api?.onDebugLog) return;

    api.onDebugLog((message: string) => {
      addLog(message);
    });

    return () => {
      api.removeDebugLogListener?.();
    };
  }, [api, addLog]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isVisible && autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, isVisible, autoScroll]);

  return {
    logs,
    isVisible,
    autoScroll,
    containerRef,
    addLog,
    clearLogs,
    toggleVisible,
    setAutoScroll,
  };
}
