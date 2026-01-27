import React from 'react';
import { useRecordingState } from './hooks/useRecordingState';
import { StopButton } from './components/StopButton';
import { TimerDisplay } from './components/TimerDisplay';
import { ActionButton } from './components/ActionButton';
import { Divider } from './components/Divider';

export function App() {
  const { elapsedMs, isLoading, stop, restart, cancel } = useRecordingState();

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 h-14 w-[280px]
                 bg-neutral-900/85 backdrop-blur-xl
                 rounded-[28px] border border-white/10
                 shadow-[0_4px_24px_rgba(0,0,0,0.4),0_0_0_1px_rgba(0,0,0,0.2)]
                 select-none font-sans
                 [-webkit-app-region:drag]"
    >
      <StopButton onClick={stop} disabled={isLoading} />

      <Divider />

      <TimerDisplay elapsedMs={elapsedMs} />

      <Divider />

      <ActionButton icon="restart" onClick={restart} disabled={isLoading} />
      <ActionButton icon="cancel" onClick={cancel} disabled={isLoading} variant="danger" />
    </div>
  );
}
