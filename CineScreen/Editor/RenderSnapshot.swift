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
    /// Precomputed auto-pan camera trajectory for every zoom section. The
    /// pan is driven by the cursor track with rule-of-thirds framing + damped
    /// follow, so it has to be integrated forward in time once — we then
    /// binary-search this array per frame.
    let panSamples: [PanSample]

    init(metadata: RecordingMetadata, zoomSections: [ZoomSection]) {
        self.metadata = metadata
        self.zoomSections = zoomSections
        self.panSamples = Self.computePanTrack(
            sections: zoomSections,
            metadata: metadata,
            config: metadata.zoom.config
        )
    }

    /// The smoothTime the live preview uses, mirrored here so the export's
    /// cursor glide matches what the user previewed. Defaults to `.slow`
    /// because the heavy smoothing reads as more cinematic and matches the
    /// Screen-Studio-style cursor glide users expect.
    var cursorSmoothTime: Double {
        let style = metadata.zoom.config.animationStyle
            .map { CursorAnimationStyle(rawValue: $0.rawValue) ?? .slow } ?? .slow
        return style.smoothTime
    }

    // MARK: - Per-frame state (deterministic, no smoothing)

    func cursorStateForExport(atMilliseconds t: Double) -> CursorRenderState? {
        guard let raw = Self.rawCursorPosition(atMilliseconds: t, metadata: metadata) else { return nil }
        let (shape, baseSize) = Self.activeShapeAndSize(
            at: t,
            keyframes: metadata.cursor.keyframes,
            fallback: metadata.cursor.config
        )
        let size = baseSize * Self.clickPopFactor(atMilliseconds: t, clicks: metadata.clicks)
        let videoSize = SIMD2(Float(metadata.video.width), Float(metadata.video.height))
        return CursorRenderState(
            positionInVideoPixels: raw,
            size: size,
            opacity: 1.0,
            shape: shape,
            hotspotUV: shape.hotspotUV,
            videoSize: videoSize
        )
    }

    /// Brief size dip when a mouse-down happens — fast scale down, slower
    /// ease back. Reads as a tactile "press" rather than a bouncy pop. Both
    /// the editor preview and the export use this so the feedback is
    /// identical across the pipeline.
    static func clickPopFactor(atMilliseconds t: Double, clicks: [ClickEvent]) -> Float {
        let popDuration: Double = 220   // ms — total animation length
        let peakAt: Double = 0.30        // normalized time of the trough (~66ms)
        let peakDip: Float = 0.30        // shrink to 70% of base size at the trough
        var factor: Float = 1.0
        for click in clicks where click.action == .down {
            let elapsed = t - click.timestamp
            guard elapsed >= 0 && elapsed <= popDuration else { continue }
            let n = elapsed / popDuration
            // Asymmetric press: easeOutCubic dip down, easeInCubic settle back.
            let bump: Double
            if n < peakAt {
                let u = n / peakAt
                bump = 1.0 - pow(1.0 - u, 3.0)
            } else {
                let u = (n - peakAt) / (1.0 - peakAt)
                bump = 1.0 - (u * u * u)
            }
            // Use the most-shrunk factor across overlapping clicks.
            factor = min(factor, 1.0 - peakDip * Float(bump))
        }
        return factor
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
        let targetCenter = panCenter(atMilliseconds: t) ?? SIMD2<Float>(0.5, 0.5)
        let neutralCenter = SIMD2<Float>(0.5, 0.5)
        let centerUV = neutralCenter + (targetCenter - neutralCenter) * Float(eased)
        return ZoomState(centerUV: centerUV, scale: Float(scale))
    }

    /// Binary-search the precomputed pan trajectory for an interpolated camera
    /// UV at the given timestamp. Returns nil if no pan sample covers `t`
    /// (e.g. cursor track is empty, or `t` is outside any zoom section).
    func panCenter(atMilliseconds t: Double) -> SIMD2<Float>? {
        guard !panSamples.isEmpty else { return nil }
        var lo = 0
        var hi = panSamples.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if panSamples[mid].t <= t { lo = mid } else { hi = mid - 1 }
        }
        let prev = panSamples[lo]
        // Only return a sample if it actually belongs to the section that
        // contains `t` — otherwise we'd hand a stale camera to a neutral gap.
        guard t >= prev.t else { return nil }
        let next = (lo + 1 < panSamples.count) ? panSamples[lo + 1] : prev
        if next.t > prev.t, next.sectionIndex == prev.sectionIndex, t <= next.t {
            let alpha = Float((t - prev.t) / (next.t - prev.t))
            return prev.camera + (next.camera - prev.camera) * min(max(alpha, 0), 1)
        }
        return prev.camera
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

    // MARK: - Auto-pan precomputation

    /// One sample on the precomputed auto-pan trajectory.
    struct PanSample: Sendable, Equatable {
        /// Milliseconds from recording start.
        var t: Double
        /// Camera center in normalized UV [0,1]² (video pixel space / video size).
        var camera: SIMD2<Float>
        /// Index of the owning zoom section, so we don't interpolate across the
        /// gap between two adjacent sections.
        var sectionIndex: Int
    }

    /// Walks each zoom section forward in time and integrates a cinematic
    /// camera that follows the cursor. Two stacked critically-damped springs
    /// give Screen Studio's "weighted glide": a fast spring pre-smooths the
    /// raw cursor (kills trackpad micro-tremor) and a slow spring drives the
    /// camera toward a soft rule-of-thirds target derived from that smoothed
    /// cursor. The result is no hard discontinuities at the dead-zone edge
    /// and a gentle, momentum-aware feel.
    static func computePanTrack(
        sections: [ZoomSection],
        metadata: RecordingMetadata,
        config: ZoomConfig
    ) -> [PanSample] {
        guard config.enabled, !sections.isEmpty else { return [] }
        let videoW = Float(max(1, metadata.video.width))
        let videoH = Float(max(1, metadata.video.height))
        // Rule-of-thirds safe box: cursor moves freely inside the middle third
        // of the visible (zoomed) frame before the camera starts to follow.
        let safeFraction: Float = 0.33
        // Camera spring smoothTime is *adaptive per axis* — long when the
        // cursor is close to the camera (cinematic glide) and short as the
        // cursor approaches the visible-frame edge (so a fast drag doesn't
        // leave the spring lagging out of frame). The cursor pre-smoothing
        // spring stays fast/static to kill trackpad jitter.
        let cameraMaxSmoothTime: Double = 0.55
        let cameraMinSmoothTime: Double = 0.12
        let cursorSmoothTime: Double = 0.12
        // Maximum fraction of visible half-extent the cursor is allowed to
        // reach before we hard-clamp the camera. Keeps the cursor inside the
        // frame even when the spring lag would otherwise push it out.
        let frameEdgeFraction: Float = 0.92
        // Pre-roll the cursor smoother so it has a steady state at section
        // start (otherwise the section's first frame can pop).
        let warmupMs: Double = 300.0
        // 240 Hz inner integration so the springs stay stable; we still emit
        // pan samples at ~60 Hz for the lookup table.
        let integrationHz: Double = 240.0
        let dtSec: Double = 1.0 / integrationHz
        let dtMs: Double = dtSec * 1000.0
        let outputIntervalMs: Double = 16.0

        var out: [PanSample] = []
        out.reserveCapacity(sections.count * 256)

        for (idx, section) in sections.enumerated() {
            let scale = Float(max(1.0, section.scale))
            let visHalfX = 0.5 / scale
            let visHalfY = 0.5 / scale
            let safeHalfX = visHalfX * safeFraction
            let safeHalfY = visHalfY * safeFraction
            let minX = visHalfX, maxX = 1.0 - visHalfX
            let minY = visHalfY, maxY = 1.0 - visHalfY

            func cursorUV(_ t: Double) -> SIMD2<Float> {
                if let p = rawCursorPosition(atMilliseconds: t, metadata: metadata) {
                    return SIMD2(p.x / videoW, p.y / videoH)
                }
                return SIMD2(0.5, 0.5)
            }

            // Clamp camera so the visible frame stays inside [0,1]², and kill
            // any velocity into the wall — otherwise the spring keeps pushing.
            func clampCameraAndKillVelocity(
                pos: inout SIMD2<Float>, vel: inout SIMD2<Float>
            ) {
                if minX > maxX || minY > maxY {
                    pos = SIMD2(0.5, 0.5)
                    vel = SIMD2(0, 0)
                    return
                }
                if pos.x < minX { pos.x = minX; if vel.x < 0 { vel.x = 0 } }
                else if pos.x > maxX { pos.x = maxX; if vel.x > 0 { vel.x = 0 } }
                if pos.y < minY { pos.y = minY; if vel.y < 0 { vel.y = 0 } }
                else if pos.y > maxY { pos.y = maxY; if vel.y > 0 { vel.y = 0 } }
            }

            // Warm up the cursor smoother on the prefix before the section so
            // its initial state isn't a "cold" jump to the raw cursor.
            var smoothCursor = cursorUV(section.startTime - warmupMs)
            var smoothCursorVel = SIMD2<Float>(0, 0)
            var twarm = section.startTime - warmupMs + dtMs
            while twarm < section.startTime {
                smoothDamp(
                    pos: &smoothCursor, vel: &smoothCursorVel,
                    target: cursorUV(twarm), smoothTime: cursorSmoothTime, dt: dtSec
                )
                twarm += dtMs
            }
            // Camera starts already aligned with the smoothed cursor (clamped),
            // with zero velocity — so the ramp-in eases from neutral center to
            // a stable point rather than to a moving target.
            var camera = smoothCursor
            var cameraVel = SIMD2<Float>(0, 0)
            clampCameraAndKillVelocity(pos: &camera, vel: &cameraVel)
            out.append(PanSample(t: section.startTime, camera: camera, sectionIndex: idx))

            var lastOutputMs = section.startTime
            var t = section.startTime + dtMs
            while t <= section.endTime {
                // 1) Pre-smooth the raw cursor.
                smoothDamp(
                    pos: &smoothCursor, vel: &smoothCursorVel,
                    target: cursorUV(t), smoothTime: cursorSmoothTime, dt: dtSec
                )

                // 2) Soft rule-of-thirds target: target == camera while the
                // smoothed cursor sits inside the safe box (zero force, so
                // the camera coasts to a halt); outside, target shifts so
                // the cursor sits exactly on the box edge.
                var target = camera
                let dx = smoothCursor.x - camera.x
                let dy = smoothCursor.y - camera.y
                if dx > safeHalfX { target.x = smoothCursor.x - safeHalfX }
                else if dx < -safeHalfX { target.x = smoothCursor.x + safeHalfX }
                if dy > safeHalfY { target.y = smoothCursor.y - safeHalfY }
                else if dy < -safeHalfY { target.y = smoothCursor.y + safeHalfY }

                // 3) Drive the camera with critically-damped springs whose
                //    smoothTime tightens as the cursor approaches the visible
                //    frame edge. Per-axis so a fast horizontal drag doesn't
                //    also tighten the vertical follow (and vice versa).
                let urgencyX = Float(min(1, max(0,
                    (Double(abs(smoothCursor.x - camera.x)) - Double(safeHalfX))
                    / Double(visHalfX - safeHalfX)
                )))
                let urgencyY = Float(min(1, max(0,
                    (Double(abs(smoothCursor.y - camera.y)) - Double(safeHalfY))
                    / Double(visHalfY - safeHalfY)
                )))
                let stX = cameraMaxSmoothTime
                    + (cameraMinSmoothTime - cameraMaxSmoothTime) * Double(urgencyX)
                let stY = cameraMaxSmoothTime
                    + (cameraMinSmoothTime - cameraMaxSmoothTime) * Double(urgencyY)
                smoothDamp1D(
                    pos: &camera.x, vel: &cameraVel.x,
                    target: target.x, smoothTime: stX, dt: dtSec
                )
                smoothDamp1D(
                    pos: &camera.y, vel: &cameraVel.y,
                    target: target.y, smoothTime: stY, dt: dtSec
                )
                clampCameraAndKillVelocity(pos: &camera, vel: &cameraVel)

                // 4) Hard frame-edge safety: even with adaptive smoothing, a
                //    sufficiently fast cursor can outpace the spring. Snap
                //    the camera forward so the cursor never leaves the
                //    visible frame, and zero velocity in that axis so the
                //    spring resumes cleanly on the next frame.
                let maxOffX = visHalfX * frameEdgeFraction
                let maxOffY = visHalfY * frameEdgeFraction
                let dcx = smoothCursor.x - camera.x
                let dcy = smoothCursor.y - camera.y
                if dcx > maxOffX { camera.x = smoothCursor.x - maxOffX; cameraVel.x = 0 }
                else if dcx < -maxOffX { camera.x = smoothCursor.x + maxOffX; cameraVel.x = 0 }
                if dcy > maxOffY { camera.y = smoothCursor.y - maxOffY; cameraVel.y = 0 }
                else if dcy < -maxOffY { camera.y = smoothCursor.y + maxOffY; cameraVel.y = 0 }
                clampCameraAndKillVelocity(pos: &camera, vel: &cameraVel)

                if t - lastOutputMs >= outputIntervalMs {
                    out.append(PanSample(t: t, camera: camera, sectionIndex: idx))
                    lastOutputMs = t
                }
                t += dtMs
            }

            // Anchor a sample exactly at endTime so the last frame reads cleanly.
            if (out.last?.t ?? -1) < section.endTime {
                out.append(PanSample(t: section.endTime, camera: camera, sectionIndex: idx))
            }
        }

        return out
    }

    /// Critically-damped spring smoothing (Unity's `Vector3.SmoothDamp` /
    /// Game Programming Gems IV "Critically Damped Spring Smoothing"). Updates
    /// `pos` and `vel` in-place toward `target`. `smoothTime` is roughly the
    /// time the spring takes to cover ~63% of the remaining distance.
    private static func smoothDamp(
        pos: inout SIMD2<Float>,
        vel: inout SIMD2<Float>,
        target: SIMD2<Float>,
        smoothTime: Double,
        dt: Double
    ) {
        let st = max(smoothTime, 1e-4)
        let omega = 2.0 / st
        let x = omega * dt
        let expFactor = Float(1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x))
        let change = pos - target
        let temp = (vel + Float(omega) * change) * Float(dt)
        vel = (vel - Float(omega) * temp) * expFactor
        pos = target + (change + temp) * expFactor
    }

    /// 1D variant — used when the camera's x and y axes need independent
    /// smoothTimes (cursor moving fast horizontally shouldn't also tighten
    /// the vertical follow).
    private static func smoothDamp1D(
        pos: inout Float,
        vel: inout Float,
        target: Float,
        smoothTime: Double,
        dt: Double
    ) {
        let st = max(smoothTime, 1e-4)
        let omega = 2.0 / st
        let x = omega * dt
        let expFactor = Float(1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x))
        let change = pos - target
        let temp = (vel + Float(omega) * change) * Float(dt)
        vel = (vel - Float(omega) * temp) * expFactor
        pos = target + (change + temp) * expFactor
    }
}
