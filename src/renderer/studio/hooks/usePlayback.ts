import { useState, useEffect, useCallback, useRef } from 'react';

export function usePlayback(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const animationFrameRef = useRef<number | null>(null);

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

  const seekTo = useCallback((timeSeconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(timeSeconds, duration));
  }, [videoRef, duration]);

  const skipForward = useCallback((seconds = 5) => {
    if (!videoRef.current) return;
    seekTo(videoRef.current.currentTime + seconds);
  }, [seekTo]);

  const skipBackward = useCallback((seconds = 5) => {
    if (!videoRef.current) return;
    seekTo(videoRef.current.currentTime - seconds);
  }, [seekTo]);

  const stepFrame = useCallback((direction: 1 | -1) => {
    if (!videoRef.current) return;
    const frameTime = 1 / 30; // ~30fps
    seekTo(videoRef.current.currentTime + direction * frameTime);
  }, [seekTo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime * 1000);
    const handleLoadedMetadata = () => setDuration(video.duration);
    const handleDurationChange = () => setDuration(video.duration);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', handleDurationChange);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', handleDurationChange);
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
