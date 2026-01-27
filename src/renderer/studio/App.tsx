import React, { useEffect } from 'react';
import { StudioProvider, useStudio } from './context/StudioContext';
import { Toolbar } from './components/Toolbar';
import { VideoPreview } from './components/VideoPreview/VideoPreview';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Timeline } from './components/Timeline/Timeline';
import { StatusBar } from './components/StatusBar';
import { resetCursorSmoothing } from '../utils/cursor-renderer';

function StudioContent() {
  const {
    isLoading,
    error,
    togglePlayPause,
    skipBackward,
    skipForward,
    stepFrame,
    isPlaying,
    seekTo,
    saveMetadata,
    showToast,
    videoRef,
  } = useStudio();

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Still allow Cmd+S in inputs
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          saveMetadata().then(success => {
            showToast(success ? 'Saved' : 'Failed to save', success ? 'success' : 'error');
          });
        }
        return;
      }

      // Cmd+S / Ctrl+S - Save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveMetadata().then(success => {
          showToast(success ? 'Saved' : 'Failed to save', success ? 'success' : 'error');
        });
        return;
      }

      // Space - Play/Pause
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
        return;
      }

      // Arrow keys
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (isPlaying) {
          skipBackward();
        } else {
          stepFrame(-1);
        }
        resetCursorSmoothing();
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (isPlaying) {
          skipForward();
        } else {
          stepFrame(1);
        }
        resetCursorSmoothing();
        return;
      }

      // J/K/L playback controls
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        skipBackward();
        resetCursorSmoothing();
        return;
      }

      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        skipForward();
        resetCursorSmoothing();
        return;
      }

      // Home/End
      if (e.key === 'Home') {
        e.preventDefault();
        seekTo(0);
        resetCursorSmoothing();
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        if (videoRef.current) {
          seekTo(videoRef.current.duration);
        }
        resetCursorSmoothing();
        return;
      }

      // Frame step with , and .
      if (e.key === ',') {
        e.preventDefault();
        stepFrame(-1);
        resetCursorSmoothing();
        return;
      }

      if (e.key === '.') {
        e.preventDefault();
        stepFrame(1);
        resetCursorSmoothing();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, skipBackward, skipForward, stepFrame, isPlaying, seekTo, saveMetadata, showToast, videoRef]);

  if (isLoading) {
    return (
      <div className="h-screen bg-[#1a1a1a] flex items-center justify-center text-[#b0b0b0]">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen bg-[#1a1a1a] flex items-center justify-center text-[#f47066]">
        {error}
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#1a1a1a] flex flex-col overflow-hidden">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <VideoPreview />
        <Sidebar />
      </div>
      <Timeline />
      <StatusBar />
    </div>
  );
}

export function App() {
  return (
    <StudioProvider>
      <StudioContent />
    </StudioProvider>
  );
}
