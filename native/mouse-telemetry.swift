#!/usr/bin/env swift

import Foundation
import AppKit
import CoreGraphics

// Initialize NSApplication to ensure AppKit cursors are available
// This is needed for NSCursor static properties to work in CLI mode
let _ = NSApplication.shared

// Private CoreGraphics functions for system-wide cursor detection
@_silgen_name("CGSCurrentCursorSeed")
func CGSCurrentCursorSeed() -> Int

@_silgen_name("CGSGetGlobalCursorDataSize")
func CGSGetGlobalCursorDataSize(_ connection: Int32, _ size: UnsafeMutablePointer<Int32>) -> Int32

@_silgen_name("CGSGetGlobalCursorData")
func CGSGetGlobalCursorData(_ connection: Int32, _ data: UnsafeMutableRawPointer, _ size: UnsafeMutablePointer<Int32>, _ rowBytes: UnsafeMutablePointer<Int32>, _ rect: UnsafeMutablePointer<CGRect>, _ hotSpot: UnsafeMutablePointer<CGPoint>, _ depth: UnsafeMutablePointer<Int32>, _ components: UnsafeMutablePointer<Int32>, _ bitsPerComponent: UnsafeMutablePointer<Int32>) -> Int32

@_silgen_name("CGSMainConnectionID")
func CGSMainConnectionID() -> Int32

// Debug mode - set via environment variable
let debugMode = ProcessInfo.processInfo.environment["DEBUG"] != nil

// Build a lookup table mapping cursor image data -> cursor type name.
// This uses actual pixel data comparison instead of just hotspot/size signatures,
// which prevents false positives when different cursors share similar dimensions.
var cursorImageLookup: [Data: String] = [:]

let knownCursors: [(String, NSCursor)] = [
    ("arrow", NSCursor.arrow),
    ("ibeam", NSCursor.iBeam),
    ("ibeamvertical", NSCursor.iBeamCursorForVerticalLayout),
    ("pointer", NSCursor.pointingHand),
    ("hand", NSCursor.openHand),
    ("closedhand", NSCursor.closedHand),
    ("crosshair", NSCursor.crosshair),
    ("resizeleftright", NSCursor.resizeLeftRight),
    ("resizeupdown", NSCursor.resizeUpDown),
    ("resizeleft", NSCursor.resizeLeft),
    ("resizeright", NSCursor.resizeRight),
    ("resizeup", NSCursor.resizeUp),
    ("resizedown", NSCursor.resizeDown),
    ("notallowed", NSCursor.operationNotAllowed),
    ("copy", NSCursor.dragCopy),
    ("draglink", NSCursor.dragLink),
    ("contextmenu", NSCursor.contextualMenu),
    ("poof", NSCursor.disappearingItem),
]

for (name, cursor) in knownCursors {
    if let tiffData = cursor.image.tiffRepresentation {
        cursorImageLookup[tiffData] = name
    }
}

if debugMode {
    fputs("DEBUG: Pre-computed image data for \(cursorImageLookup.count) cursor types\n", stderr)
}

// Cursor seed caching - only redetect when cursor actually changes
var lastCursorSeed: Int = -1
var lastCursorType: String = "arrow"

// Helper to get cursor signature (hotspot + size) - used as fallback
func getCursorSignature(_ cursor: NSCursor) -> (hotspotX: Double, hotspotY: Double, width: Double, height: Double) {
    let hotspot = cursor.hotSpot
    let size = cursor.image.size
    return (Double(hotspot.x), Double(hotspot.y), Double(size.width), Double(size.height))
}

// Check if two cursor signatures match (with tolerance)
func signaturesMatch(
    _ sig1: (hotspotX: Double, hotspotY: Double, width: Double, height: Double),
    _ sig2: (hotspotX: Double, hotspotY: Double, width: Double, height: Double),
    tolerance: Double = 0.5
) -> Bool {
    return abs(sig1.hotspotX - sig2.hotspotX) <= tolerance &&
           abs(sig1.hotspotY - sig2.hotspotY) <= tolerance &&
           abs(sig1.width - sig2.width) <= tolerance &&
           abs(sig1.height - sig2.height) <= tolerance
}

// Get the current system cursor type using NSCursor.currentSystem
func getCurrentCursorType() -> String {
    // Use cursor seed to skip detection when cursor hasn't changed
    let currentSeed = CGSCurrentCursorSeed()
    if currentSeed == lastCursorSeed {
        return lastCursorType
    }
    lastCursorSeed = currentSeed

    // Use NSCursor.currentSystem to get the actual system cursor
    guard let currentCursor = NSCursor.currentSystem else {
        if debugMode {
            fputs("DEBUG: NSCursor.currentSystem returned nil, defaulting to arrow\n", stderr)
        }
        lastCursorType = "arrow"
        return "arrow"
    }

    // Primary detection: compare actual image data for exact matching
    if let currentTiff = currentCursor.image.tiffRepresentation,
       let matchedType = cursorImageLookup[currentTiff] {
        if debugMode {
            fputs("DEBUG: Matched cursor type '\(matchedType)' via image data\n", stderr)
        }
        lastCursorType = matchedType
        return matchedType
    }

    // Fallback: signature matching for cursors whose image data may differ
    // (e.g. resolution variants or dynamic cursors)
    let currentSig = getCursorSignature(currentCursor)

    if debugMode {
        fputs("DEBUG: Image data match failed, falling back to signature matching\n", stderr)
        fputs("DEBUG: Current cursor - hotspot=(\(currentSig.hotspotX), \(currentSig.hotspotY)) size=(\(currentSig.width), \(currentSig.height))\n", stderr)
    }

    // Check arrow first since it's the most common fallback cursor
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.arrow)) {
        lastCursorType = "arrow"
        return "arrow"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.iBeam)) {
        lastCursorType = "ibeam"
        return "ibeam"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.pointingHand)) {
        lastCursorType = "pointer"
        return "pointer"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.openHand)) {
        lastCursorType = "hand"
        return "hand"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.closedHand)) {
        lastCursorType = "closedhand"
        return "closedhand"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.crosshair)) {
        lastCursorType = "crosshair"
        return "crosshair"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeLeftRight)) {
        lastCursorType = "resizeleftright"
        return "resizeleftright"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeUpDown)) {
        lastCursorType = "resizeupdown"
        return "resizeupdown"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeLeft)) {
        lastCursorType = "resizeleft"
        return "resizeleft"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeRight)) {
        lastCursorType = "resizeright"
        return "resizeright"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeUp)) {
        lastCursorType = "resizeup"
        return "resizeup"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.resizeDown)) {
        lastCursorType = "resizedown"
        return "resizedown"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.iBeamCursorForVerticalLayout)) {
        lastCursorType = "ibeamvertical"
        return "ibeamvertical"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.dragCopy)) {
        lastCursorType = "copy"
        return "copy"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.dragLink)) {
        lastCursorType = "draglink"
        return "draglink"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.contextualMenu)) {
        lastCursorType = "contextmenu"
        return "contextmenu"
    }
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.disappearingItem)) {
        lastCursorType = "poof"
        return "poof"
    }
    // notallowed is checked LAST in fallback - it should almost never reach here
    // since image data comparison above handles it accurately
    if signaturesMatch(currentSig, getCursorSignature(NSCursor.operationNotAllowed)) {
        lastCursorType = "notallowed"
        return "notallowed"
    }

    // Default to arrow for unrecognized cursors (custom cursors from apps)
    if debugMode {
        fputs("DEBUG: Unrecognized cursor (possibly custom), defaulting to arrow\n", stderr)
    }
    lastCursorType = "arrow"
    return "arrow"
}

// Get mouse button states
func getMouseButtonStates() -> (left: Bool, right: Bool, middle: Bool) {
    let left = CGEventSource.buttonState(.combinedSessionState, button: .left)
    let right = CGEventSource.buttonState(.combinedSessionState, button: .right)
    let middle = CGEventSource.buttonState(.combinedSessionState, button: .center)
    return (left, right, middle)
}

// Get mouse position
func getMousePosition() -> CGPoint {
    return NSEvent.mouseLocation
}

// Get main screen height for coordinate conversion
func getMainScreenHeight() -> CGFloat {
    return NSScreen.main?.frame.height ?? 0
}

// Check for streaming mode via command line argument
let streamingMode = CommandLine.arguments.contains("--stream")
let streamInterval: UInt32 = 4000 // 4ms = 250Hz sample rate

func outputTelemetry() {
    let cursorType = getCurrentCursorType()
    let buttons = getMouseButtonStates()
    let position = getMousePosition()
    let screenHeight = getMainScreenHeight()

    // Convert from macOS coordinates (origin at bottom-left) to standard coordinates (origin at top-left)
    let adjustedY = screenHeight - position.y

    // Output as JSON for easy parsing
    let output: [String: Any] = [
        "cursor": cursorType,
        "buttons": [
            "left": buttons.left,
            "right": buttons.right,
            "middle": buttons.middle
        ],
        "position": [
            "x": Int(position.x),
            "y": Int(adjustedY)
        ]
    ]

    if let jsonData = try? JSONSerialization.data(withJSONObject: output, options: []),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
        fflush(stdout)
    }
}

if streamingMode {
    // Streaming mode: continuously output telemetry at high frequency
    // Read from stdin to know when to stop (parent process closes pipe)
    while true {
        outputTelemetry()
        usleep(streamInterval)
    }
} else {
    // Single-shot mode: output once and exit (backwards compatible)
    outputTelemetry()
}
