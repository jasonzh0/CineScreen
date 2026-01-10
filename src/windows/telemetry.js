/**
 * Windows Mouse Telemetry using koffi
 * Replicates the functionality of native/mouse-telemetry.swift for Windows
 */

const koffi = require('koffi');

// Load User32.dll
const user32 = koffi.load('user32.dll');

// Define structures
const POINT = koffi.struct('POINT', {
    x: 'long',
    y: 'long'
});

const CURSORINFO = koffi.struct('CURSORINFO', {
    cbSize: 'uint32',
    flags: 'uint32',
    hCursor: 'pointer',
    ptScreenPos: POINT
});

// Define functions
const GetCursorPos = user32.func('bool GetCursorPos(POINT* lpPoint)');
const GetCursorInfo = user32.func('bool GetCursorInfo(CURSORINFO* pci)');
const GetAsyncKeyState = user32.func('short GetAsyncKeyState(int vKey)');
const GetSystemMetrics = user32.func('int GetSystemMetrics(int nIndex)');

// Virtual key codes for mouse buttons
const VK_LBUTTON = 0x01;
const VK_RBUTTON = 0x02;
const VK_MBUTTON = 0x04;

// System cursor handles (loaded at runtime)
let cursorHandles = {};

// Load standard cursor handles for identification
function loadCursorHandles() {
    try {
        const LoadCursorW = user32.func('pointer LoadCursorW(pointer hInstance, pointer lpCursorName)');

        // Standard cursor IDs (MAKEINTRESOURCE values)
        const cursorIds = {
            arrow: 32512,      // IDC_ARROW
            ibeam: 32513,      // IDC_IBEAM
            wait: 32514,       // IDC_WAIT
            cross: 32515,      // IDC_CROSS
            uparrow: 32516,    // IDC_UPARROW
            sizenwse: 32642,   // IDC_SIZENWSE
            sizenesw: 32643,   // IDC_SIZENESW
            sizewe: 32644,     // IDC_SIZEWE
            sizens: 32645,     // IDC_SIZENS
            sizeall: 32646,    // IDC_SIZEALL
            no: 32648,         // IDC_NO
            hand: 32649,       // IDC_HAND
            appstarting: 32650,// IDC_APPSTARTING
            help: 32651        // IDC_HELP
        };

        for (const [name, id] of Object.entries(cursorIds)) {
            // MAKEINTRESOURCE is just casting the integer to a pointer
            const cursor = LoadCursorW(null, koffi.as(id, 'pointer'));
            if (cursor) {
                cursorHandles[cursor.toString()] = name;
            }
        }
    } catch (e) {
        console.error('Failed to load cursor handles:', e);
    }
}

/**
 * Get the current cursor type by comparing handle
 */
function getCursorType(hCursor) {
    if (!hCursor) return 'arrow';

    const handleStr = hCursor.toString();
    const cursorName = cursorHandles[handleStr];

    if (cursorName) {
        // Map Windows cursor names to the app's expected names
        const nameMap = {
            'arrow': 'arrow',
            'ibeam': 'ibeam',
            'wait': 'wait',
            'cross': 'crosshair',
            'uparrow': 'resizeup',
            'sizenwse': 'resizenwse',
            'sizenesw': 'resizenesw',
            'sizewe': 'resizeleftright',
            'sizens': 'resizeupdown',
            'sizeall': 'move',
            'no': 'notallowed',
            'hand': 'pointer',
            'appstarting': 'wait',
            'help': 'help'
        };
        return nameMap[cursorName] || 'arrow';
    }

    return 'arrow'; // Default for custom cursors
}

/**
 * Check if a mouse button is pressed
 */
function isButtonPressed(vKey) {
    const state = GetAsyncKeyState(vKey);
    // High-order bit indicates if key is currently down
    return (state & 0x8000) !== 0;
}

/**
 * Get all mouse telemetry data
 */
function getMouseTelemetry() {
    // Get cursor position
    const point = {};
    GetCursorPos(point);

    // Get cursor info (includes handle for cursor type detection)
    const cursorInfo = {
        cbSize: 20 + koffi.sizeof('pointer'), // sizeof(CURSORINFO)
        flags: 0,
        hCursor: null,
        ptScreenPos: { x: 0, y: 0 }
    };
    cursorInfo.cbSize = 24; // Correct size for 64-bit
    GetCursorInfo(cursorInfo);

    // Get button states
    const buttons = {
        left: isButtonPressed(VK_LBUTTON),
        right: isButtonPressed(VK_RBUTTON),
        middle: isButtonPressed(VK_MBUTTON)
    };

    // Determine cursor type
    const cursorType = getCursorType(cursorInfo.hCursor);

    return {
        cursor: cursorType,
        buttons: buttons,
        position: {
            x: point.x || 0,
            y: point.y || 0
        }
    };
}

// Initialize cursor handles
loadCursorHandles();

// Check for streaming mode
const streamingMode = process.argv.includes('--stream');
const streamInterval = 4; // 4ms = 250Hz sample rate

function outputTelemetry() {
    const data = getMouseTelemetry();
    console.log(JSON.stringify(data));
}

if (streamingMode) {
    // Streaming mode: continuously output at high frequency
    setInterval(outputTelemetry, streamInterval);
} else {
    // Single-shot mode
    outputTelemetry();
    process.exit(0);
}
