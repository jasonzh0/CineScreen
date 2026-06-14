import Foundation
import simd

// MARK: - Top-level

/// The on-disk metadata bundle that sits next to the recorded video.
/// JSON shape mirrors `src/types/metadata.ts` so native recordings load in the
/// v1.6 Electron studio unchanged.
struct RecordingMetadata: Codable, Equatable {
    var version: String = "1.0.0"
    var video: VideoInfo
    var cursor: CursorTrack
    var zoom: ZoomTrack
    var clicks: [ClickEvent]
    var effects: MouseEffectsConfig?
    var trim: TrimRange?
    /// Optional webcam overlay layout. Absent for recordings without a
    /// sibling webcam.mp4 — and for older recordings made before the webcam
    /// editor controls landed.
    var webcam: WebcamLayout?
    /// User-selected canvas styling (background, padding, drop shadow).
    /// Absent for projects saved before this field existed; in that case the
    /// editor falls back to its default style.
    var canvas: CanvasStyleConfig?
    var createdAt: TimeInterval

    static let currentVersion = "1.0.0"
}

/// Persistable subset of CanvasStyle so the user's chosen background +
/// padding + shadow survive close/reopen.
struct CanvasStyleConfig: Codable, Equatable {
    var background: CanvasBackground
    var padding: Double
    var dropShadow: Bool
    /// 0..1 strength of the drop shadow. Optional because older saves
    /// predate it; the editor falls back to its default when missing.
    var shadowStrength: Double?
}

/// User-editable layout for the circular webcam overlay. Coordinates are
/// normalised to the canvas's content rect: (0, 0) = top-left of content,
/// (1, 1) = bottom-right. `diameterNorm` is measured against the shorter
/// side of the content rect.
struct WebcamLayout: Codable, Equatable {
    var enabled: Bool
    var centerXNorm: Float
    var centerYNorm: Float
    var diameterNorm: Float

    static let `default` = WebcamLayout(
        enabled: true,
        centerXNorm: 0.91,
        centerYNorm: 0.91,
        diameterNorm: 0.18
    )

    /// Clamp the layout to sensible bounds so the user can't drag the
    /// overlay off-canvas or shrink it into oblivion.
    func clamped() -> WebcamLayout {
        let d = max(0.05, min(0.6, diameterNorm))
        return WebcamLayout(
            enabled: enabled,
            centerXNorm: max(0, min(1, centerXNorm)),
            centerYNorm: max(0, min(1, centerYNorm)),
            diameterNorm: d
        )
    }
}

// MARK: - Video

struct VideoInfo: Codable, Equatable {
    var path: String
    var width: Int
    var height: Int
    var frameRate: Double
    /// Duration in **milliseconds** (matches the TS schema).
    var duration: Double
}

struct TrimRange: Codable, Equatable {
    var startMs: Double
    var endMs: Double
}

// MARK: - Cursor

struct CursorTrack: Codable, Equatable {
    var keyframes: [CursorKeyframe]
    var segments: [CursorSegment]?
    var config: CursorConfig
}

struct CursorKeyframe: Codable, Equatable {
    /// Milliseconds from recording start.
    var timestamp: Double
    var x: Double
    var y: Double
    var size: Double?
    var shape: CursorShape?
    var easing: EasingType?
}

struct CursorSegment: Codable, Equatable {
    var start: CursorKeyframe
    var end: CursorKeyframe
    var easing: EasingType
}

enum EasingType: String, Codable {
    case linear
    case easeIn
    case easeOut
    case easeInOut
}

enum CursorShape: String, Codable, CaseIterable {
    case arrow
    case pointer
    case hand
    case openhand
    case closedhand
    case crosshair
    case ibeam
    case ibeamvertical
    case move
    case resizeleft
    case resizeright
    case resizeleftright
    case resizeup
    case resizedown
    case resizeupdown
    case resize
    case copy
    case dragcopy
    case draglink
    case help
    case notallowed
    case contextmenu
    case poof
    case screenshot
    case zoomin
    case zoomout
}

extension CursorShape {
    /// The cursor's *hot spot* expressed as a normalized fraction of its sprite
    /// artwork, top-left origin, in `[0, 1]²`. macOS reports the pointer's
    /// location as the hot spot (e.g. the very tip of the arrow), so the sprite
    /// must be positioned so this point lands on the recorded location — drawing
    /// the sprite *centered* on it (the old behaviour) made the rendered cursor
    /// sit ~half a sprite down-and-right of where the real pointer was, and
    /// click rings (which are centered on the true click point) didn't line up
    /// with the arrow tip.
    ///
    /// Values were measured from each 128px asset's opaque artwork: tip-style
    /// cursors anchor on their pointing apex, everything else on its centre.
    var hotspotUV: SIMD2<Float> {
        switch self {
        // Arrow-family — anchor on the tip in the upper-left of the artwork.
        case .arrow:                 return SIMD2(0.313, 0.230)
        case .contextmenu:           return SIMD2(0.250, 0.230)
        case .copy, .dragcopy:       return SIMD2(0.230, 0.075)
        case .draglink:              return SIMD2(0.340, 0.285)
        // Pointing hand — anchor on the index fingertip.
        case .pointer:               return SIMD2(0.406, 0.255)
        // Open/closed hands (pan/grab) — anchor on the palm centre.
        case .hand, .openhand:       return SIMD2(0.470, 0.445)
        case .closedhand:            return SIMD2(0.480, 0.500)
        // Symmetric cursors — the active point is the geometric centre.
        case .ibeam:                 return SIMD2(0.500, 0.500)
        case .ibeamvertical:         return SIMD2(0.500, 0.485)
        case .crosshair:             return SIMD2(0.500, 0.500)
        case .move:                  return SIMD2(0.500, 0.500)
        case .resize, .resizeleft, .resizeright, .resizeleftright,
             .resizeup, .resizedown, .resizeupdown:
                                     return SIMD2(0.500, 0.500)
        case .notallowed:            return SIMD2(0.500, 0.500)
        case .help:                  return SIMD2(0.500, 0.500)
        case .poof:                  return SIMD2(0.500, 0.500)
        case .screenshot:            return SIMD2(0.500, 0.500)
        case .zoomin, .zoomout:      return SIMD2(0.430, 0.430)
        }
    }
}

struct CursorConfig: Codable, Equatable {
    var size: Double
    var shape: CursorShape
    var motionBlur: MotionBlur?
    var hideWhenStatic: Bool?

    struct MotionBlur: Codable, Equatable {
        var enabled: Bool
        var strength: Double
    }
}

// MARK: - Clicks

struct ClickEvent: Codable, Equatable {
    var timestamp: Double
    var x: Double
    var y: Double
    var button: MouseButton
    var action: ClickAction
}

enum MouseButton: String, Codable {
    case left, right, middle
}

enum ClickAction: String, Codable {
    case down, up
}

// MARK: - Zoom

struct ZoomTrack: Codable, Equatable {
    var sections: [ZoomSection]
    var config: ZoomConfig
}

struct ZoomSection: Codable, Equatable {
    var startTime: Double
    var endTime: Double
    var scale: Double
    var centerX: Double
    var centerY: Double
}

struct ZoomConfig: Codable, Equatable {
    var enabled: Bool
    var level: Double
    var transitionSpeed: Double
    var padding: Double
    var followSpeed: Double
    var smoothness: Smoothness?
    var animationStyle: AnimationStyle?
    var deadZone: Double?
    var motionBlur: CursorConfig.MotionBlur?
    var physics: Physics?
    var autoZoom: Bool?

    enum Smoothness: String, Codable {
        case snappy, smooth, cinematic
    }

    enum AnimationStyle: String, Codable {
        case slow, mellow, quick, rapid
    }

    struct Physics: Codable, Equatable {
        var tension: Double?
        var friction: Double?
        var mass: Double?
    }
}

// MARK: - Effects

struct MouseEffectsConfig: Codable, Equatable {
    var clickCircles: ClickCircles
    var trail: Trail
    var highlightRing: HighlightRing

    struct ClickCircles: Codable, Equatable {
        var enabled: Bool
        var size: Double
        var color: String
        var duration: Double
    }

    struct Trail: Codable, Equatable {
        var enabled: Bool
        var length: Int
        var fadeSpeed: Double
        var color: String
    }

    struct HighlightRing: Codable, Equatable {
        var enabled: Bool
        var size: Double
        var color: String
        var pulseSpeed: Double
    }
}

// MARK: - I/O

extension RecordingMetadata {
    static func decode(from data: Data) throws -> RecordingMetadata {
        let decoder = JSONDecoder()
        return try decoder.decode(RecordingMetadata.self, from: data)
    }

    static func decode(from url: URL) throws -> RecordingMetadata {
        let data = try Data(contentsOf: url)
        return try decode(from: data)
    }

    func encode() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }

    func write(to url: URL) throws {
        let data = try encode()
        try data.write(to: url, options: .atomic)
    }
}
