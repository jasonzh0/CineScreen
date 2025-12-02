#!/usr/bin/env swift

import Foundation
import CoreGraphics

// Query mouse button states using CGEventSource.buttonState
// Modern Swift API replaces CGEventSourceButtonState
let left = CGEventSource.buttonState(.combinedSessionState, button: .left)
let right = CGEventSource.buttonState(.combinedSessionState, button: .right)
let middle = CGEventSource.buttonState(.combinedSessionState, button: .center)

// Output as comma-separated values: left,right,middle (1 = pressed, 0 = not pressed)
print("\(left ? 1 : 0),\(right ? 1 : 0),\(middle ? 1 : 0)")

