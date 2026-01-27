import { useState, useEffect, useCallback, useRef } from 'react';

export function usePlayback(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const rafRef = useRef<number | null>(null);
  const isSeeking = useRef(false);

  const play = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      await videoRef.current.play();
    } catch (err) {
      console.error('Failed to play video:', err);
    }
  }, [videoRef]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, [videoRef]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // React-first: Update state immediately, then sync video element
  const seekTo = useCallback((timeSeconds: number) => {
    if (!videoRef.current) return;
    const maxTime = videoRef.current.duration || Infinity;
    const clampedTime = Math.max(0, Math.min(timeSeconds, maxTime));

    // 1. Update React state immediately (UI updates now)
    setCurrentTime(clampedTime * 1000);

    // 2. Mark as seeking to prevent RAF from overwriting during seek
    isSeeking.current = true;

    // 3. Sync video element
    videoRef.current.currentTime = clampedTime;
  }, [videoRef]);

  // Use React state for skip calculations instead of video.currentTime
  const skipForward = useCallback((seconds = 5) => {
    seekTo(currentTime / 1000 + seconds);
  }, [currentTime, seekTo]);

  const skipBackward = useCallback((seconds = 5) => {
    seekTo(currentTime / 1000 - seconds);
  }, [currentTime, seekTo]);

  const stepFrame = useCallback((direction: 1 | -1) => {
    const frameTime = 1 / 30; // ~30fps
    seekTo(currentTime / 1000 + direction * frameTime);
  }, [currentTime, seekTo]);

  // RAF loop for smooth playback sync (only runs when playing)
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const syncLoop = () => {
      if (videoRef.current && isPlaying && !isSeeking.current) {
        setCurrentTime(videoRef.current.currentTime * 1000);
      }
      rafRef.current = requestAnimationFrame(syncLoop);
    };
    rafRef.current = requestAnimationFrame(syncLoop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, videoRef]);

  // Video element event listeners - polls until video element is available
  useEffect(() => {
    let mounted = true;
    let pollInterval: number | null = null;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    const updateDuration = (video: HTMLVideoElement) => {
      const dur = video.duration;
      if (dur && !isNaN(dur) && isFinite(dur)) {
        setDuration(dur);
      }
    };

    const handleLoadedMetadata = (e: Event) => {
      const video = e.target as HTMLVideoElement;
      updateDuration(video);
      setCurrentTime(video.currentTime * 1000);
    };

    const handleDurationChange = (e: Event) => {
      const video = e.target as HTMLVideoElement;
      updateDuration(video);
    };

    const handleSeeked = () => {
      isSeeking.current = false;
    };

    const attachListeners = (video: HTMLVideoElement) => {
      video.addEventListener('play', handlePlay);
      video.addEventListener('pause', handlePause);
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      video.addEventListener('durationchange', handleDurationChange);
      video.addEventListener('ended', handleEnded);
      video.addEventListener('seeked', handleSeeked);

      // Initialize from video if already loaded
      if (video.readyState >= 1) {
        updateDuration(video);
        setCurrentTime(video.currentTime * 1000);
      }
    };

    const detachListeners = (video: HTMLVideoElement) => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('seeked', handleSeeked);
    };

    // Poll until video element is available
    const checkForVideo = () => {
      const video = videoRef.current;
      if (video && mounted) {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        attachListeners(video);
      }
    };

    // Initial check
    checkForVideo();

    // If video not available yet, poll for it
    if (!videoRef.current) {
      pollInterval = window.setInterval(checkForVideo, 50);
    }

    return () => {
      mounted = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      const video = videoRef.current;
      if (video) {
        detachListeners(video);
      }
    };
  }, [videoRef]);

  return {
    isPlaying,
    currentTime, // in ms
    duration, // in seconds
    play,
    pause,
    togglePlayPause,
    seekTo,
    skipForward,
    skipBackward,
    stepFrame,
  };
}
