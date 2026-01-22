/**
 * Windows Mouse Telemetry using koffi
 * Replicates the functionality of native/mouse-telemetry.swift for Windows
 */

const koffi = require('koffi');

// Load User32.dll
const user32 = koffi.load('user32.dll');

// Define structures with explicit packing
const POINT = koffi.struct('POINT', {
    x: 'int32',
    y: 'int32'
});

// Define functions - use _Out_ pointer style
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ POINT* lpPoint)');
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');

// Virtual key codes for mouse buttons
const VK_LBUTTON = 0x01;
const VK_RBUTTON = 0x02;
const VK_MBUTTON = 0x04;

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
    // Create a proper output buffer for POINT struct
    const pointBuffer = Buffer.alloc(koffi.sizeof(POINT));
    const success = GetCursorPos(pointBuffer);

    let x = 0, y = 0;
    if (success) {
        // Read the values from the buffer
        x = pointBuffer.readInt32LE(0);
        y = pointBuffer.readInt32LE(4);
    }

    // Get button states
    const buttons = {
        left: isButtonPressed(VK_LBUTTON),
        right: isButtonPressed(VK_RBUTTON),
        middle: isButtonPressed(VK_MBUTTON)
    };

    return {
        cursor: 'arrow', // Simplified - cursor type detection can be added later
        buttons: buttons,
        position: {
            x: x,
            y: y
        }
    };
}

// Check for streaming mode
const streamingMode = process.argv.includes('--stream');
const streamInterval = 4; // 4ms = 250Hz sample rate

function outputTelemetry() {
    try {
        const data = getMouseTelemetry();
        console.log(JSON.stringify(data));
    } catch (e) {
        // Output default data on error to keep stream alive
        console.log(JSON.stringify({
            cursor: 'arrow',
            buttons: { left: false, right: false, middle: false },
            position: { x: 0, y: 0 }
        }));
    }
}

if (streamingMode) {
    // Streaming mode: continuously output at high frequency
    setInterval(outputTelemetry, streamInterval);
} else if (require.main === module) {
    // Single-shot mode - only run when executed directly
    outputTelemetry();
    process.exit(0);
}

// Export for direct require() from Electron main process
module.exports = { getMouseTelemetry };
