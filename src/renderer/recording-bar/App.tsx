import React from 'react';
import { useRecordingState } from './hooks/useRecordingState';
import { StopButton } from './components/StopButton';
import { TimerDisplay } from './components/TimerDisplay';
import { ActionButton } from './components/ActionButton';
import { Divider } from './components/Divider';
import { RecordButton } from './components/RecordButton';
import { MenuButton } from './components/MenuButton';

export function App() {
  const {
    elapsedMs,
    isLoading,
    mode,
    startRecording,
    stop,
    restart,
    cancel,
    openMainWindow,
  } = useRecordingState();

  const barClasses = `flex items-center gap-1.5 px-2 py-1.5 h-12 w-[208px]
                      bg-neutral-900/85 backdrop-blur-xl
                      shadow-[0_4px_24px_rgba(0,0,0,0.4)]
                      select-none font-sans
                      [-webkit-app-region:drag]`;

  // Idle mode: Record button + Menu
  if (mode === 'idle') {
    return (
      <div className={barClasses}>
        <RecordButton onClick={startRecording} disabled={isLoading} />

        <Divider />

        <div className="flex-1" />

        <MenuButton onOpenSettings={openMainWindow} />
      </div>
    );
  }

  // Recording mode: Stop, timer, restart, cancel
  return (
    <div className={barClasses}>
      <StopButton onClick={stop} disabled={isLoading} />

      <Divider />

      <TimerDisplay elapsedMs={elapsedMs} />

      <Divider />

      <ActionButton icon="restart" onClick={restart} disabled={isLoading} />
      <ActionButton icon="cancel" onClick={cancel} disabled={isLoading} variant="danger" />
    </div>
  );
}
