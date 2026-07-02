import Foundation
@testable import CineScreen

/// Shared builders for metadata fixtures used across the unit tests.
enum Fixtures {
    static func metadata(
        width: Int = 2000,
        height: Int = 1000,
        duration: Double = 10_000,
        keyframes: [CursorKeyframe] = [],
        clicks: [ClickEvent] = [],
        sections: [ZoomSection] = [],
        zoomEnabled: Bool = true,
        webcamOffsetMs: Double? = nil
    ) -> RecordingMetadata {
        RecordingMetadata(
            version: RecordingMetadata.currentVersion,
            video: VideoInfo(
                path: "/tmp/fixture.mp4",
                width: width,
                height: height,
                frameRate: 60,
                duration: duration
            ),
            cursor: CursorTrack(
                keyframes: keyframes,
                segments: nil,
                config: CursorConfig(size: 96, shape: .arrow, motionBlur: nil, hideWhenStatic: nil)
            ),
            zoom: ZoomTrack(
                sections: sections,
                config: ZoomConfig(
                    enabled: zoomEnabled,
                    level: 2.0,
                    transitionSpeed: 300,
                    padding: 0,
                    followSpeed: 1.0,
                    smoothness: nil,
                    animationStyle: .mellow,
                    deadZone: nil,
                    motionBlur: nil,
                    physics: nil,
                    autoZoom: false
                )
            ),
            clicks: clicks,
            effects: nil,
            trim: nil,
            webcamOffsetMs: webcamOffsetMs,
            createdAt: 0
        )
    }

    static func keyframe(_ t: Double, _ x: Double, _ y: Double) -> CursorKeyframe {
        CursorKeyframe(timestamp: t, x: x, y: y, size: nil, shape: .arrow, easing: .linear)
    }

    static func click(_ t: Double, x: Double = 0, y: Double = 0, action: ClickAction = .down) -> ClickEvent {
        ClickEvent(timestamp: t, x: x, y: y, button: .left, action: action)
    }

    static func section(_ start: Double, _ end: Double, scale: Double = 2.0) -> ZoomSection {
        ZoomSection(startTime: start, endTime: end, scale: scale, centerX: 0, centerY: 0)
    }
}
