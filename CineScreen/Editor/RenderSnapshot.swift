import Foundation
import simd

/// Reference-typed wrapper around `SmoothPosition2D` so the export's per-frame
/// closure can mutate smoothing state across calls. The export pipeline
/// processes frames serially on one queue, so unchecked Sendable is safe.
final class ExportCursorSmoother: @unchecked Sendable {
    private var smoother: SmoothPosition2D
    private var lastT: Double = -1

    init(smoothTime: Double) {
        self.smoother = SmoothPosition2D(x: 0, y: 0, smoothTime: smoothTime)
    }

    func smoothed(target: SIMD2<Float>, atMilliseconds t: Double) -> SIMD2<Float> {
        let dt: Double
        if lastT < 0 {
            smoother.reset(toX: Double(target.x), y: Double(target.y))
            dt = 1.0 / 60.0
        } else {
            dt = max(0.0001, (t - lastT) / 1000.0)
        }
        lastT = t
        let result = smoother.update(
            targetX: Double(target.x),
            targetY: Double(target.y),
            deltaTime: dt
        )
        return SIMD2(Float(result.x), Float(result.y))
    }
}

/// Sendable, immutable snapshot of everything the per-frame state functions
/// need. Built on the main actor at export start, then passed into the
/// export pipeline's worker queues. The snapshot's methods are pure
/// functions of (metadata, time) so they can run anywhere safely.
///
/// Replaces the `MainActor.assumeIsolated { vm?.cursorStateForExport(...) }`
/// pattern that was crashing the app — that pattern traps when called from
/// the export's background queues.
struct RenderSnapshot: Sendable {
    let metadata: RecordingMetadata
    let zoomSections: [ZoomSection]

    /// The smoothTime the live preview uses, mirrored here so the export's
    /// cursor glide matches what the user previewed.
    var cursorSmoothTime: Double {
        let style = metadata.zoom.config.animationStyle
            .map { CursorAnimationStyle(rawValue: $0.rawValue) ?? .mellow } ?? .mellow
        return style.smoothTime
    }

    // MARK: - Per-frame state (deterministic, no smoothing)

    func cursorStateForExport(atMilliseconds t: Double) -> CursorRenderState? {
        guard let raw = Self.rawCursorPosition(atMilliseconds: t, metadata: metadata) else { return nil }
        let (shape, size) = Self.activeShapeAndSize(
            at: t,
            keyframes: metadata.cursor.keyframes,
            fallback: metadata.cursor.config
        )
        let videoSize = SIMD2(Float(metadata.video.width), Float(metadata.video.height))
        return CursorRenderState(
            positionInVideoPixels: raw,
            size: size,
            opacity: 1.0,
            shape: shape,
            videoSize: videoSize
        )
    }

    func clickRingStates(atMilliseconds t: Double) -> [ClickRingState] {
        let cfg = metadata.effects?.clickCircles
        guard cfg?.enabled ?? false else { return [] }
        let size = cfg?.size ?? 64
        let duration = cfg?.duration ?? 600
        let color = Self.parseHexColor(cfg?.color ?? "#ffffff")

        var out: [ClickRingState] = []
        for click in metadata.clicks where click.action == .down {
            let elapsed = t - click.timestamp
            if elapsed < 0 || elapsed > duration { continue }
            let progress = elapsed / duration
            let eased = 1 - pow(1 - progress, 3)
            let radius = Float(size) * Float(eased) * 0.5
            let opacity = Float(1 - progress) * 0.85
            var ringColor = color
            ringColor.w *= opacity
            out.append(ClickRingState(
                centerInVideoPixels: SIMD2(Float(click.x), Float(click.y)),
                radiusInPixels: radius,
                thicknessInPixels: 4,
                color: ringColor
            ))
        }
        return out
    }

    func zoomState(atMilliseconds t: Double) -> ZoomState {
        guard metadata.zoom.config.enabled else { return .identity }
        guard let active = zoomSections.first(where: { t >= $0.startTime && t <= $0.endTime }) else {
            return .identity
        }
        // 700ms cubic ramp — feels noticeably more cinematic than a 400ms
        // quad ramp and matches Screen Studio's default zoom feel. Shared
        // by editor preview and export so both use the exact same curve.
        let duration = active.endTime - active.startTime
        let elapsed = t - active.startTime
        let half = duration / 2
        let rampMs = min(700.0, half)
        let progress: Double
        if elapsed < rampMs {
            progress = elapsed / rampMs
        } else if elapsed > duration - rampMs {
            progress = (duration - elapsed) / rampMs
        } else {
            progress = 1.0
        }
        let eased = Self.easeInOutCubic(min(max(progress, 0), 1))
        let scale = 1.0 + (active.scale - 1.0) * eased
        let targetCenter = SIMD2(
            Float(active.centerX / Double(metadata.video.width)),
            Float(active.centerY / Double(metadata.video.height))
        )
        let neutralCenter = SIMD2<Float>(0.5, 0.5)
        let centerUV = neutralCenter + (targetCenter - neutralCenter) * Float(eased)
        return ZoomState(centerUV: centerUV, scale: Float(scale))
    }

    // MARK: - Helpers (static, no isolation)

    static func rawCursorPosition(atMilliseconds t: Double, metadata: RecordingMetadata) -> SIMD2<Float>? {
        let frames = metadata.cursor.keyframes
        guard !frames.isEmpty else { return nil }

        var lo = 0
        var hi = frames.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if frames[mid].timestamp <= t { lo = mid } else { hi = mid - 1 }
        }
        let prev = frames[lo]
        let next = (lo + 1 < frames.count) ? frames[lo + 1] : prev
        if next.timestamp > prev.timestamp {
            let alpha = Float((t - prev.timestamp) / (next.timestamp - prev.timestamp))
            let a = SIMD2(Float(prev.x), Float(prev.y))
            let b = SIMD2(Float(next.x), Float(next.y))
            return a + (b - a) * min(max(alpha, 0), 1)
        }
        return SIMD2(Float(prev.x), Float(prev.y))
    }

    static func activeShapeAndSize(
        at t: Double,
        keyframes: [CursorKeyframe],
        fallback: CursorConfig
    ) -> (CursorShape, Float) {
        guard !keyframes.isEmpty else { return (fallback.shape, Float(fallback.size)) }
        var lo = 0
        var hi = keyframes.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if keyframes[mid].timestamp <= t { lo = mid } else { hi = mid - 1 }
        }
        let kf = keyframes[min(lo, keyframes.count - 1)]
        return (kf.shape ?? fallback.shape, Float(kf.size ?? fallback.size))
    }

    static func parseHexColor(_ hex: String) -> SIMD4<Float> {
        var s = hex
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else {
            return SIMD4(1, 1, 1, 1)
        }
        let r = Float((v >> 16) & 0xff) / 255
        let g = Float((v >> 8) & 0xff) / 255
        let b = Float(v & 0xff) / 255
        return SIMD4(r, g, b, 1)
    }

    static func easeInOut(_ t: Double) -> Double {
        return t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
    }

    /// Slower start/end than quadratic — gives the zoom a more cinematic feel.
    static func easeInOutCubic(_ t: Double) -> Double {
        return t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
    }
}
