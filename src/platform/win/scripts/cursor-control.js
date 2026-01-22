/**
 * Windows Cursor Control using koffi
 * Replicates the functionality of native/cursor-control.swift for Windows
 * 
 * Note: Windows doesn't have a direct equivalent to CGDisplayHideCursor.
 * This implementation uses SetSystemCursor to replace cursors with invisible ones,
 * and SystemParametersInfo to restore them.
 */

const koffi = require('koffi');
const path = require('path');
const fs = require('fs');

// Load User32.dll
const user32 = koffi.load('user32.dll');

// Define functions
const ShowCursor = user32.func('int ShowCursor(bool bShow)');
const SystemParametersInfoW = user32.func('bool SystemParametersInfoW(uint uiAction, uint uiParam, pointer pvParam, uint fWinIni)');

// Constants
const SPI_SETCURSORS = 0x0057;

// Track hide count for reference counting like macOS
let hideCount = 0;

/**
 * Hide the system cursor
 * Uses ShowCursor which uses reference counting (like macOS CGDisplayHideCursor)
 */
function hideCursor() {
    // ShowCursor decrements display count when false, increments when true
    // Cursor is hidden when count < 0
    const count = ShowCursor(false);
    hideCount++;
    console.log('OK');
}

/**
 * Show the system cursor
 */
function showCursor() {
    const count = ShowCursor(true);
    if (hideCount > 0) hideCount--;
    console.log('OK');
}

/**
 * Restore all system cursors to default
 * This is a fallback to ensure cursors are visible
 */
function restoreCursors() {
    // SPI_SETCURSORS reloads system cursors from registry
    SystemParametersInfoW(SPI_SETCURSORS, 0, null, 0);
    hideCount = 0;
    console.log('OK');
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
    console.error('Usage: cursor-control [hide|show|restore]');
    process.exit(1);
}

const command = args[0].toLowerCase();

switch (command) {
    case 'hide':
        hideCursor();
        break;
    case 'show':
        showCursor();
        break;
    case 'restore':
        restoreCursors();
        break;
    default:
        console.error(`Unknown command: ${command}`);
        console.error('Usage: cursor-control [hide|show|restore]');
        process.exit(1);
}
