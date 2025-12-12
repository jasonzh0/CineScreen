#!/usr/bin/env swift

import Foundation
import AppKit
import CoreGraphics

// Get the current system cursor type
func getCurrentCursorType() -> String {
    let currentCursor = NSCursor.current

    // Compare with standard cursors
    if currentCursor == NSCursor.arrow {
        return "arrow"
    } else if currentCursor == NSCursor.iBeam {
        return "ibeam"
    } else if currentCursor == NSCursor.crosshair {
        return "crosshair"
    } else if currentCursor == NSCursor.closedHand {
        return "closedhand"
    } else if currentCursor == NSCursor.openHand {
        return "hand"
    } else if currentCursor == NSCursor.pointingHand {
        return "pointer"
    } else if currentCursor == NSCursor.resizeLeft {
        return "resizeleft"
    } else if currentCursor == NSCursor.resizeRight {
        return "resizeright"
    } else if currentCursor == NSCursor.resizeLeftRight {
        return "resizeleftright"
    } else if currentCursor == NSCursor.resizeUp {
        return "resizeup"
    } else if currentCursor == NSCursor.resizeDown {
        return "resizedown"
    } else if currentCursor == NSCursor.resizeUpDown {
        return "resizeupdown"
    } else if currentCursor == NSCursor.disappearingItem {
        return "poof"
    } else if currentCursor == NSCursor.operationNotAllowed {
        return "notallowed"
    } else if currentCursor == NSCursor.dragLink {
        return "draglink"
    } else if currentCursor == NSCursor.dragCopy {
        return "copy"
    } else if currentCursor == NSCursor.contextualMenu {
        return "contextmenu"
    }

    // Check if available on macOS 11+
    if #available(macOS 11.0, *) {
        if currentCursor == NSCursor.iBeamCursorForVerticalLayout {
            return "ibeamvertical"
        }
    }

    // Default to arrow for unknown cursor types
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

// Main execution
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
}
