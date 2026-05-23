import Foundation
import AppKit
import CoreGraphics

/// One captured mouse event, in the recording's pixel-coordinate space.
struct MouseSample {
    enum Kind {
        case move
        case down(MouseButton)
        case up(MouseButton)
    }

    /// Milliseconds from recording start.
    var timestamp: Double
    /// Pixel-space X within the recorded image.
    var x: Double
    /// Pixel-space Y within the recorded image (top-left origin).
    var y: Double
    var kind: Kind
    var cursorShape: CursorShape
}

enum MouseTrackingError: LocalizedError {
    case accessibilityNotGranted
    case tapCreationFailed

    var errorDescription: String? {
        switch self {
        case .accessibilityNotGranted:
            return "Accessibility permission is required to track the cursor."
        case .tapCreationFailed:
            return "Could not install a CGEventTap. Check Accessibility permission."
        }
    }
}

@MainActor
final class MouseTrackingService {
    /// Display bounds in points; used to map global-coord mouse positions
    /// onto the recorded image.
    private var displayBoundsPoints: CGRect = .zero
    /// Pixel size of the recorded image (output frame).
    private var pixelSize: CGSize = .zero
    /// scaleFactor = pixelSize / displayBounds — cached for the hot path.
    private var scale: CGFloat = 2.0
    /// If a region was captured, this offset is subtracted (in pixels)
    /// before clamping to pixelSize.
    private var regionOffsetPixels: CGPoint = .zero

    private var startTime: CFAbsoluteTime = 0
    private var tap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    private(set) var samples: [MouseSample] = []
    private(set) var isTracking = false

    /// Built lazily on `start()` so that NSCursor's class properties are
    /// fully initialised by the time we read them. Initialising in the
    /// property declaration ran the lookup against an empty NSApp state and
    /// the table came out 0 / 0.
    private var cursorIdentifier: CursorIdentifier?

    // MARK: - Lifecycle

    func start(displayBoundsPoints: CGRect, pixelSize: CGSize, regionOffsetPixels: CGPoint = .zero) throws {
        guard !isTracking else { return }
        guard AXIsProcessTrusted() else {
            throw MouseTrackingError.accessibilityNotGranted
        }

        self.displayBoundsPoints = displayBoundsPoints
        self.pixelSize = pixelSize
        self.scale = displayBoundsPoints.width > 0
            ? CGFloat(pixelSize.width) / displayBoundsPoints.width
            : 2.0
        self.regionOffsetPixels = regionOffsetPixels
        self.samples = []
        self.startTime = CFAbsoluteTimeGetCurrent()
        // Build the cursor lookup AFTER NSApp is fully up — see comment on
        // the `cursorIdentifier` property.
        self.cursorIdentifier = CursorIdentifier()

        let types: [CGEventType] = [
            .mouseMoved,
            .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
            .leftMouseDown, .rightMouseDown, .otherMouseDown,
            .leftMouseUp, .rightMouseUp, .otherMouseUp,
        ]
        var mask: CGEventMask = 0
        for type in types {
            mask |= CGEventMask(1) << CGEventMask(type.rawValue)
        }

        let context = Unmanaged.passUnretained(self).toOpaque()

        let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: { _, type, event, refcon -> Unmanaged<CGEvent>? in
                guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
                let service = Unmanaged<MouseTrackingService>.fromOpaque(refcon).takeUnretainedValue()
                service.recordEvent(type: type, event: event)
                return Unmanaged.passUnretained(event)
            },
            userInfo: context
        )

        guard let tap = tap else { throw MouseTrackingError.tapCreationFailed }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)

        self.tap = tap
        self.runLoopSource = source
        self.isTracking = true

        // Seed with the current cursor position so the timeline always has a t=0 sample.
        let now = NSEvent.mouseLocation
        record(point: now, kind: .move)

        Log.mouse.info("Mouse tracking started")
    }

    func stop() -> [MouseSample] {
        guard isTracking else { return samples }
        if let tap = tap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        }
        tap = nil
        runLoopSource = nil
        isTracking = false
        Log.mouse.info("Mouse tracking stopped, samples=\(self.samples.count)")
        return samples
    }

    // MARK: - Event recording

    nonisolated private func recordEvent(type: CGEventType, event: CGEvent) {
        // CGEventTap callback fires on the main run loop in this tap mode,
        // but we route through the main actor anyway for state safety.
        let location = event.location
        // CGEvent.location uses global screen coordinates with origin at TOP-left.
        // NSEvent.mouseLocation uses bottom-left. We'll standardize on top-left
        // here since CGEvent gives it to us directly.
        let kind: MouseSample.Kind
        switch type {
        case .leftMouseDown:   kind = .down(.left)
        case .rightMouseDown:  kind = .down(.right)
        case .otherMouseDown:  kind = .down(.middle)
        case .leftMouseUp:     kind = .up(.left)
        case .rightMouseUp:    kind = .up(.right)
        case .otherMouseUp:    kind = .up(.middle)
        default:               kind = .move
        }

        // Hop to main to mutate.
        DispatchQueue.main.async { [self] in
            // CGEvent.location is already top-left origin in *global* coords (points).
            // Convert to bottom-left coordinates (NSEvent style) so we share the
            // same path as the seed sample.
            let screenHeight = NSScreen.main?.frame.height ?? 0
            let point = CGPoint(x: location.x, y: screenHeight - location.y)
            self.record(point: point, kind: kind)
        }
    }

    private func record(point pointInScreenPoints: CGPoint, kind: MouseSample.Kind) {
        let now = CFAbsoluteTimeGetCurrent()
        let elapsedMs = (now - startTime) * 1000.0

        // Convert NSEvent-style (origin bottom-left) to top-left point coords.
        let screenHeight = NSScreen.main?.frame.height ?? 0
        let topLeftPoint = CGPoint(x: pointInScreenPoints.x, y: screenHeight - pointInScreenPoints.y)

        // Clip out events that landed outside the recorded display, but record
        // them anyway — the editor decides what to do.
        let pixelX = (topLeftPoint.x * scale) - regionOffsetPixels.x
        let pixelY = (topLeftPoint.y * scale) - regionOffsetPixels.y

        let clampedX = min(max(pixelX, 0), pixelSize.width)
        let clampedY = min(max(pixelY, 0), pixelSize.height)

        let shape = cursorIdentifier?.currentShape() ?? .arrow

        samples.append(MouseSample(
            timestamp: elapsedMs,
            x: Double(clampedX),
            y: Double(clampedY),
            kind: kind,
            cursorShape: shape
        ))
    }
}

// MARK: - Cursor identification
//
// Ported from native/mouse-telemetry.swift. Matches NSCursor.currentSystem
// against the table of known cursors by comparing TIFF data.

/// Direct port of native/mouse-telemetry.swift's cursor identifier — uses
/// image-data equality first, then falls back to (hotspot + size) signature
/// matching for cursors whose TIFF data varies between Retina representations.
private final class CursorIdentifier {
    private struct Signature: Hashable {
        let hotspotX: Int
        let hotspotY: Int
        let width: Int
        let height: Int
    }

    private var dataLookup: [Data: CursorShape] = [:]
    private var sigLookup: [(Signature, CursorShape)] = []
    private var lastSeed: Int = .min
    private var lastShape: CursorShape = .arrow

    init() {
        let table: [(CursorShape, NSCursor)] = [
            (.arrow, .arrow),
            (.ibeam, .iBeam),
            (.ibeamvertical, .iBeamCursorForVerticalLayout),
            (.pointer, .pointingHand),
            (.hand, .openHand),
            (.closedhand, .closedHand),
            (.crosshair, .crosshair),
            (.resizeleftright, .resizeLeftRight),
            (.resizeupdown, .resizeUpDown),
            (.resizeleft, .resizeLeft),
            (.resizeright, .resizeRight),
            (.resizeup, .resizeUp),
            (.resizedown, .resizeDown),
            (.notallowed, .operationNotAllowed),
            (.copy, .dragCopy),
            (.draglink, .dragLink),
            (.contextmenu, .contextualMenu),
            (.poof, .disappearingItem),
        ]
        for (shape, cursor) in table {
            if let data = cursor.image.tiffRepresentation {
                dataLookup[data] = shape
            }
            sigLookup.append((Self.signature(for: cursor), shape))
        }
        Log.mouse.info("CursorIdentifier ready, \(self.dataLookup.count) shapes matched by TIFF data, \(self.sigLookup.count) by signature")
    }

    /// Returns the current system cursor's matching `CursorShape`. Tries:
    /// 1. TIFF byte equality
    /// 2. (hotspot + size) signature matching with tolerance
    /// Falls back to `.arrow` on miss.
    func currentShape() -> CursorShape {
        let seed = CursorIdentifier.currentSeed()
        if seed == lastSeed { return lastShape }
        lastSeed = seed

        guard let current = NSCursor.currentSystem else {
            lastShape = .arrow
            return .arrow
        }

        // 1. Exact image bytes
        if let data = current.image.tiffRepresentation,
           let shape = dataLookup[data] {
            if shape != lastShape {
                Log.mouse.debug("Cursor type → \(shape.rawValue) (by data)")
            }
            lastShape = shape
            return shape
        }

        // 2. Signature fallback
        let target = Self.signature(for: current)
        for (sig, shape) in sigLookup {
            if Self.matches(target, sig) {
                if shape != lastShape {
                    Log.mouse.debug("Cursor type → \(shape.rawValue) (by signature)")
                }
                lastShape = shape
                return shape
            }
        }

        lastShape = .arrow
        return .arrow
    }

    private static func signature(for cursor: NSCursor) -> Signature {
        let hotspot = cursor.hotSpot
        let size = cursor.image.size
        return Signature(
            hotspotX: Int(hotspot.x.rounded()),
            hotspotY: Int(hotspot.y.rounded()),
            width: Int(size.width.rounded()),
            height: Int(size.height.rounded())
        )
    }

    private static func matches(_ a: Signature, _ b: Signature, tolerance: Int = 1) -> Bool {
        abs(a.hotspotX - b.hotspotX) <= tolerance &&
        abs(a.hotspotY - b.hotspotY) <= tolerance &&
        abs(a.width - b.width) <= tolerance &&
        abs(a.height - b.height) <= tolerance
    }

    private static func currentSeed() -> Int {
        return _CGSCurrentCursorSeed()
    }
}

@_silgen_name("CGSCurrentCursorSeed")
private func _CGSCurrentCursorSeed() -> Int
