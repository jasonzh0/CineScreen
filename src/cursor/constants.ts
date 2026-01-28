/**
 * Shared cursor constants
 * Used by both the preview renderer (browser) and processing renderer (Node.js)
 */

/**
 * Map cursor shape names to asset file names
 * Includes all system cursor types detected by cursor-type binary
 */
export const CURSOR_SHAPE_MAP: Record<string, string> = {
  // Standard cursors
  arrow: 'default.svg',
  pointer: 'handpointing.svg',
  hand: 'handopen.svg',
  openhand: 'handopen.svg',
  closedhand: 'handgrabbing.svg',
  crosshair: 'cross.svg',
  ibeam: 'textcursor.svg',
  ibeamvertical: 'textcursorvertical.svg',

  // Resize cursors
  move: 'move.svg',
  resizeleft: 'resizeleftright.svg',
  resizeright: 'resizeleftright.svg',
  resizeleftright: 'resizeleftright.svg',
  resizeup: 'resizeupdown.svg',
  resizedown: 'resizeupdown.svg',
  resizeupdown: 'resizeupdown.svg',
  resize: 'resizenortheastsouthwest.svg',
  resizenortheast: 'resizenortheastsouthwest.svg',
  resizesouthwest: 'resizenortheastsouthwest.svg',
  resizenorthwest: 'resizenorthwestsoutheast.svg',
  resizesoutheast: 'resizenorthwestsoutheast.svg',

  // Action cursors
  copy: 'copy.svg',
  dragcopy: 'copy.svg',
  draglink: 'default.svg',
  help: 'help.svg',
  notallowed: 'notallowed.svg',
  contextmenu: 'contextualmenu.svg',
  poof: 'poof.svg',

  // Screenshot/zoom cursors
  screenshot: 'screenshotselection.svg',
  zoomin: 'zoomin.svg',
  zoomout: 'zoomout.svg',
};

/**
 * Cursor hotspot offsets (x, y) within the 32x32 viewBox
 * These represent the click point within the cursor image
 */
export const CURSOR_HOTSPOT_MAP: Record<string, { x: number; y: number }> = {
  // Standard cursors
  arrow: { x: 10, y: 7 },
  pointer: { x: 9, y: 8 },
  hand: { x: 10, y: 10 },
  openhand: { x: 10, y: 10 },
  closedhand: { x: 10, y: 10 },
  crosshair: { x: 16, y: 16 },
  ibeam: { x: 13, y: 8 },
  ibeamvertical: { x: 8, y: 16 },

  // Resize cursors - centered
  move: { x: 16, y: 16 },
  resizeleft: { x: 16, y: 16 },
  resizeright: { x: 16, y: 16 },
  resizeleftright: { x: 16, y: 16 },
  resizeup: { x: 16, y: 16 },
  resizedown: { x: 16, y: 16 },
  resizeupdown: { x: 16, y: 16 },
  resize: { x: 16, y: 16 },
  resizenortheast: { x: 16, y: 16 },
  resizesouthwest: { x: 16, y: 16 },
  resizenorthwest: { x: 16, y: 16 },
  resizesoutheast: { x: 16, y: 16 },

  // Action cursors
  copy: { x: 10, y: 7 },
  dragcopy: { x: 10, y: 7 },
  draglink: { x: 10, y: 7 },
  help: { x: 10, y: 7 },
  notallowed: { x: 16, y: 16 },
  contextmenu: { x: 10, y: 7 },
  poof: { x: 16, y: 16 },

  // Zoom/screenshot cursors
  zoomin: { x: 10, y: 10 },
  zoomout: { x: 10, y: 10 },
  screenshot: { x: 16, y: 16 },
};

/**
 * Get cursor hotspot offset for a given shape
 */
export function getCursorHotspot(shape: string): { x: number; y: number } {
  return CURSOR_HOTSPOT_MAP[shape] || CURSOR_HOTSPOT_MAP.arrow || { x: 10, y: 7 };
}

