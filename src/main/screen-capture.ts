import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import ffmpegStatic from 'ffmpeg-static';
import type { RecordingConfig } from '../types';

export class ScreenCapture {
  private recordingProcess?: ChildProcess;
  private outputPath: string = '';
  private isRecording = false;

  /**
   * Start screen recording using ffmpeg
   * Note: This uses the system's screen capture, which on macOS can be done via avfoundation
   */
  async startRecording(config: RecordingConfig): Promise<void> {
    if (this.isRecording) {
      throw new Error('Recording is already in progress');
    }

    this.outputPath = config.outputPath;
    this.isRecording = true;

    // Ensure output directory exists
    const outputDir = join(this.outputPath, '..');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Use ffmpeg with avfoundation to capture screen
    // Note: This requires screen recording permission
    const args = [
      '-f', 'avfoundation',
      '-framerate', String(config.frameRate || 30),
      '-i', '1:0', // Screen input (1) with no audio (0)
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', this.getCrfValue(config.quality || 'medium'),
      '-movflags', 'faststart',
      this.outputPath,
    ];

    // If region is specified, add crop filter
    if (config.region) {
      const { x, y, width, height } = config.region;
      const cropIndex = args.indexOf('-c:v');
      args.splice(cropIndex, 0, 
        '-vf', `crop=${width}:${height}:${x}:${y}`
      );
    }

    return new Promise((resolve, reject) => {
      // Use ffmpeg-static to get the bundled ffmpeg binary path
      // The binary will be unpacked from asar in production builds
      const ffmpegPath = ffmpegStatic;
      
      if (!ffmpegPath) {
        reject(new Error('FFmpeg binary not found. Please ensure ffmpeg-static is installed.'));
        return;
      }
      
      this.recordingProcess = spawn(ffmpegPath, args);

      this.recordingProcess.on('error', (error) => {
        this.isRecording = false;
        reject(new Error(`Failed to start recording: ${error.message}`));
      });

      this.recordingProcess.stderr?.on('data', (data) => {
        // FFmpeg outputs to stderr
        const output = data.toString();
        if (output.includes('frame=')) {
          // Recording started successfully
          resolve();
        }
      });

      // Give it a moment to start
      setTimeout(() => {
        if (this.isRecording) {
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Stop screen recording
   */
  async stopRecording(): Promise<string> {
    if (!this.isRecording || !this.recordingProcess) {
      throw new Error('No recording in progress');
    }

    return new Promise((resolve, reject) => {
      // Send 'q' to ffmpeg to quit gracefully
      this.recordingProcess?.stdin?.write('q');
      this.recordingProcess?.stdin?.end();

      this.recordingProcess?.on('close', (code) => {
        this.isRecording = false;
        this.recordingProcess = undefined;
        
        if (code === 0 || code === null) {
          resolve(this.outputPath);
        } else {
          reject(new Error(`Recording stopped with code ${code}`));
        }
      });

      // Force kill after timeout if it doesn't stop gracefully
      setTimeout(() => {
        if (this.recordingProcess) {
          this.recordingProcess.kill();
          this.isRecording = false;
          resolve(this.outputPath);
        }
      }, 5000);
    });
  }

  /**
   * Get CRF value based on quality setting
   */
  private getCrfValue(quality: 'low' | 'medium' | 'high'): string {
    switch (quality) {
      case 'low':
        return '28';
      case 'medium':
        return '23';
      case 'high':
        return '18';
      default:
        return '23';
    }
  }

  /**
   * Check if currently recording
   */
  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }
}

