import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { CursorConfig } from '../types';

/**
 * Generate SVG cursor based on shape and size
 */
export function generateCursorSVG(config: CursorConfig): string {
  const { size, shape, color = '#000000' } = config;

  switch (shape) {
    case 'arrow':
      return generateArrowCursor(size, color);
    case 'pointer':
      return generatePointerCursor(size, color);
    case 'hand':
      return generateHandCursor(size, color);
    case 'crosshair':
      return generateCrosshairCursor(size, color);
    default:
      return generateArrowCursor(size, color);
  }
}

/**
 * Generate arrow cursor SVG
 */
function generateArrowCursor(size: number, color: string): string {
  const scale = size / 20;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L ${16 * scale} ${4 * scale} L ${12 * scale} ${8 * scale} L ${18 * scale} ${14 * scale} L ${14 * scale} ${16 * scale} L ${8 * scale} ${10 * scale} L ${4 * scale} ${16 * scale} Z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Generate pointer cursor SVG
 */
function generatePointerCursor(size: number, color: string): string {
  const scale = size / 20;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <path d="M ${2 * scale} ${2 * scale} L ${14 * scale} ${2 * scale} L ${14 * scale} ${8 * scale} L ${18 * scale} ${8 * scale} L ${10 * scale} ${18 * scale} L ${8 * scale} ${14 * scale} L ${2 * scale} ${14 * scale} Z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Generate hand cursor SVG
 */
function generateHandCursor(size: number, color: string): string {
  const scale = size / 20;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <path d="M ${4 * scale} ${2 * scale} Q ${2 * scale} ${4 * scale} ${2 * scale} ${6 * scale} L ${2 * scale} ${12 * scale} Q ${2 * scale} ${14 * scale} ${4 * scale} ${14 * scale} L ${6 * scale} ${14 * scale} L ${6 * scale} ${16 * scale} Q ${6 * scale} ${18 * scale} ${8 * scale} ${18 * scale} L ${12 * scale} ${18 * scale} Q ${14 * scale} ${18 * scale} ${14 * scale} ${16 * scale} L ${14 * scale} ${10 * scale} L ${16 * scale} ${8 * scale} Q ${18 * scale} ${8 * scale} ${18 * scale} ${6 * scale} L ${18 * scale} ${4 * scale} Q ${18 * scale} ${2 * scale} ${16 * scale} ${2 * scale} Z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Generate crosshair cursor SVG
 */
function generateCrosshairCursor(size: number, color: string): string {
  const scale = size / 20;
  const center = 10 * scale;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${center}" y1="${2 * scale}" x2="${center}" y2="${8 * scale}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <line x1="${center}" y1="${12 * scale}" x2="${center}" y2="${18 * scale}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <line x1="${2 * scale}" y1="${center}" x2="${8 * scale}" y2="${center}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <line x1="${12 * scale}" y1="${center}" x2="${18 * scale}" y2="${center}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <circle cx="${center}" cy="${center}" r="${1.5 * scale}" 
              fill="${color}" 
              stroke="#ffffff" 
              stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Save cursor SVG to file
 */
export function saveCursorToFile(filePath: string, svg: string): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, svg);
}

/**
 * Convert SVG to PNG using a simple approach
 * Note: In production, you'd use a library like sharp or canvas
 */
export async function convertSVGToPNG(
  svgPath: string,
  pngPath: string,
  size: number
): Promise<void> {
  // For now, we'll use a shell command with rsvg-convert or similar
  // In a real implementation, you'd use a Node.js library
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    // Try using rsvg-convert if available
    await execAsync(
      `rsvg-convert -w ${size} -h ${size} "${svgPath}" -o "${pngPath}"`
    );
  } catch (error) {
    // Fallback: use ImageMagick or other tool
    try {
      await execAsync(
        `convert -background none -resize ${size}x${size} "${svgPath}" "${pngPath}"`
      );
    } catch (error2) {
      // If neither is available, we'll need to handle this in video processing
      // For now, just copy the SVG (FFmpeg can handle SVG with libvips)
      throw new Error(
        'No SVG to PNG converter available. Please install rsvg-convert or ImageMagick.'
      );
    }
  }
}

