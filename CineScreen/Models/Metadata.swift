import Foundation

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
    var createdAt: TimeInterval

    static let currentVersion = "1.0.0"
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
