import Foundation
import simd

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
    /// Mouse-down timestamps (ms), sorted ascending — the click-window
    /// smoothing collapse binary-searches this per frame.
    let clickDownTimesMs: [Double]
    /// Precomputed smoothed-cursor trajectory in video pixels. Integrated once
    /// at a fixed high rate (frame-rate independent) so the editor preview and
    /// the export sample the *exact same* deterministic glide — no live,
    /// stateful spring that could diverge between the two pipelines or jitter
    /// when frame delivery timing varies. Binary-searched per frame via
    /// `smoothedCursorPosition`.
    let cursorSamples: [CursorSample]

    init(metadata: RecordingMetadata, zoomSections: [ZoomSection]) {
        self.metadata = metadata
        // Defensive sort: the pan table is binary-searched by time and
        // `zoomState` scans in order — both require sorted sections
        // regardless of what the caller (or an old metadata file) hands us.
        let sorted = zoomSections.sorted { $0.startTime < $1.startTime }
        self.zoomSections = sorted
        let clickDowns = metadata.clicks
            .filter { $0.action == .down }
            .map(\.timestamp)
            .sorted()
        self.clickDownTimesMs = clickDowns
        self.panSamples = Self.computePanTrack(
            sections: sorted,
            metadata: metadata,
            config: metadata.zoom.config
        )
        self.cursorSamples = Self.computeCursorTrack(
            metadata: metadata,
            clickDownTimesMs: clickDowns
        )
    }

    /// Defaults to `.slow` because the heavy smoothing reads as more cinematic
    /// and matches the Screen-Studio-style cursor glide users expect.
    private var cursorAnimationStyle: CursorAnimationStyle {
        metadata.zoom.config.animationStyle
            .map { CursorAnimationStyle(rawValue: $0.rawValue) ?? .slow } ?? .slow
    }

    /// Canonical smooth-time policy at `t`, as a pure function (unit-tested in
    /// isolation): gentle glide when the cursor is slow/idle, tightening when
    /// urgency is high so the rendered sprite stays on the real pointer (and
    /// therefore on click targets, which are positioned from the raw track).
    /// Urgency comes from raw cursor speed and, when the caller passes the
    /// sprite's current position via `spriteAt`, from how far the sprite trails
    /// the raw pointer — which covers fast-move-then-stop, where speed alone
    /// collapses too early. See
    /// `CursorAnimationStyle.smoothTime(forSpeedPxPerSec:lagPx:videoWidth:)`.
    ///
    /// `computeCursorTrack` applies this same policy per integration step (with
    /// an EMA-smoothed speed the loop can't express as a pure function of `t`);
    /// this method is the specification the track is validated against.
    func adaptiveCursorSmoothTime(atMilliseconds t: Double, spriteAt sprite: SIMD2<Float>? = nil) -> Double {
        let speed = Self.cursorSpeedPxPerSec(atMilliseconds: t, metadata: metadata)
        var lagPx = 0.0
        if let sprite, let raw = Self.rawCursorPosition(atMilliseconds: t, metadata: metadata) {
            let dx = Double(raw.x - sprite.x)
            let dy = Double(raw.y - sprite.y)
            lagPx = (dx * dx + dy * dy).squareRoot()
        }
        let base = cursorAnimationStyle.smoothTime(
            forSpeedPxPerSec: speed,
            lagPx: lagPx,
            videoWidth: Double(metadata.video.width)
        )
        // Collapse smoothing to ~zero in a small window around each mouse-down
        // so the sprite lands exactly on the true click point — that's where
        // lag is most visible. The cursor is decelerating into the click
        // anyway, so tightening as it arrives reads naturally rather than as a
        // snap. The gentle glide is preserved everywhere outside the click
        // window. Mouse-ups are deliberately excluded (matching clickPopFactor
        // and the click rings): collapsing at a drag release would snap the
        // sprite with no visual event to explain it.
        return base * clickProximityFactor(atMilliseconds: t)
    }

    /// 0 exactly at a mouse-down timestamp, ramping linearly to 1 once
    /// `window` ms away. Multiplied into the cursor smooth-time so
    /// position-smoothing vanishes at clicks (sprite == raw pointer) and
    /// returns to full between clicks.
    func clickProximityFactor(atMilliseconds t: Double, window: Double = 140) -> Double {
        Self.proximityFactor(to: clickDownTimesMs, at: t, window: window)
    }

    /// Distance-based ramp: 0 at any timestamp in `times`, 1 once `window` ms
    /// from all of them. `times` must be sorted ascending; binary-searched, so
    /// this stays cheap at 60 Hz even on click-heavy recordings.
    static func proximityFactor(to times: [Double], at t: Double, window: Double) -> Double {
        guard !times.isEmpty else { return 1 }
        var lo = 0, hi = times.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if times[mid] < t { lo = mid + 1 } else { hi = mid }
        }
        var nearest = Double.greatestFiniteMagnitude
        if lo < times.count { nearest = min(nearest, times[lo] - t) }
        if lo > 0 { nearest = min(nearest, t - times[lo - 1]) }
        return min(1.0, nearest / window)
    }

    /// Instantaneous cursor speed in video px/sec, sampled over a short window.
    static func cursorSpeedPxPerSec(atMilliseconds t: Double, metadata: RecordingMetadata) -> Double {
        let lookbackMs = 16.0
        guard let cur = rawCursorPosition(atMilliseconds: t, metadata: metadata) else { return 0 }
        let prev = rawCursorPosition(atMilliseconds: t - lookbackMs, metadata: metadata) ?? cur
        let dx = Double(cur.x - prev.x)
        let dy = Double(cur.y - prev.y)
        return (dx * dx + dy * dy).squareRoot() / (lookbackMs / 1000.0)
    }

    // MARK: - Per-frame state (deterministic)
    //
    // Fully smoothed: the sprite position comes from the precomputed cursor
    // track (`smoothedCursorPosition`), so this one call is the complete render
    // state for both the editor preview and the export — no external, stateful
    // spring layered on top. Falls back to the raw pointer only when the track
    // is empty (0–1 keyframes).

    func cursorStateForExport(atMilliseconds t: Double) -> CursorRenderState? {
        guard let raw = Self.rawCursorPosition(atMilliseconds: t, metadata: metadata) else { return nil }
        let position = smoothedCursorPosition(atMilliseconds: t) ?? raw
        let (shape, baseSize) = Self.activeShapeAndSize(
            at: t,
            keyframes: metadata.cursor.keyframes,
            fallback: metadata.cursor.config
        )
        let size = baseSize * Self.clickPopFactor(atMilliseconds: t, clicks: metadata.clicks)
        let videoSize = SIMD2(Float(metadata.video.width), Float(metadata.video.height))
        let cfg = metadata.cursor.config

        // --- Sprite velocity (video px/sec) from the SMOOTHED track, so the
        // motion-blur smear matches the sprite's actual on-screen travel rather
        // than the raw pointer's. Kept as explicit Float locals so the
        // type-checker stays fast. ---
        let lookbackMs = 16.0
        let prev = smoothedCursorPosition(atMilliseconds: t - lookbackMs) ?? position
        let dx: Float = position.x - prev.x
        let dy: Float = position.y - prev.y
        let dist: Float = (dx * dx + dy * dy).squareRoot()
        let speed: Float = dist / Float(lookbackMs / 1000.0)

        // --- Motion blur: smear the sprite along its per-frame travel ---
        var motionBlurUV = SIMD2<Float>(0, 0)
        if let mb = cfg.motionBlur, mb.enabled, speed > 1, size > 0 {
            let den: Float = dist > 0.0001 ? dist : 0.0001
            let dirX: Float = dx / den
            let dirY: Float = dy / den
            let exposure: Float = 1.0 / 60.0          // ~one frame of travel
            let amplify: Float = 2.0
            let strength: Float = Float(mb.strength)
            let rawLen: Float = speed * exposure * strength * amplify
            let lenPx: Float = min(rawLen, 0.4 * size)
            let uv: Float = lenPx / size               // sprite-UV units
            motionBlurUV = SIMD2<Float>(dirX * uv, dirY * uv)
        }

        // --- Hide-when-static: fade the cursor out once it's been idle ---
        var opacity: Float = 1.0
        if cfg.hideWhenStatic == true {
            let idleMs = t - Self.lastKeyframeTimestamp(atMilliseconds: t, keyframes: metadata.cursor.keyframes)
            let holdMs = 1400.0, fadeMs = 450.0
            if idleMs > holdMs {
                opacity = 1.0 - Float(min(1.0, (idleMs - holdMs) / fadeMs))
            }
        }

        return CursorRenderState(
            positionInVideoPixels: position,
            size: size,
            opacity: opacity,
            shape: shape,
            hotspotUV: shape.hotspotUV,
            motionBlurUV: motionBlurUV,
            videoSize: videoSize
        )
    }

    /// Timestamp of the last keyframe at or before `t`. Because the recorder
    /// only emits keyframes on movement, the gap since this timestamp is how
    /// long the cursor has been stationary — used for hide-when-static.
    static func lastKeyframeTimestamp(atMilliseconds t: Double, keyframes: [CursorKeyframe]) -> Double {
        guard !keyframes.isEmpty else { return t }
        var lo = 0, hi = keyframes.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if keyframes[mid].timestamp <= t { lo = mid } else { hi = mid - 1 }
        }
        return keyframes[lo].timestamp
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
        // 700ms quintic-smootherstep ramp — matches Screen Studio's cinematic
        // zoom feel, and the C2 curve means zoom *acceleration* eases in and
        // out with no perceptible jerk at the ramp ends (the old cubic ease was
        // only C1). Shared by editor preview and export for an identical curve.
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
        let eased = Self.smootherStep(min(max(progress, 0), 1))
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

    /// Interpolated smoothed-cursor position (video pixels) from the precomputed
    /// track. Returns nil when the track is empty (0–1 keyframes) so callers
    /// fall back to the raw pointer. Clamps to the track ends for times outside
    /// the recorded range.
    func smoothedCursorPosition(atMilliseconds t: Double) -> SIMD2<Float>? {
        guard !cursorSamples.isEmpty else { return nil }
        var lo = 0
        var hi = cursorSamples.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if cursorSamples[mid].t <= t { lo = mid } else { hi = mid - 1 }
        }
        let prev = cursorSamples[lo]
        let next = (lo + 1 < cursorSamples.count) ? cursorSamples[lo + 1] : prev
        if next.t > prev.t {
            let alpha = Float(min(max((t - prev.t) / (next.t - prev.t), 0), 1))
            return prev.pos + (next.pos - prev.pos) * alpha
        }
        return prev.pos
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

    /// Quintic smootherstep (Perlin). C2-continuous — first *and* second
    /// derivatives are zero at both ends — so anything eased through it (the
    /// zoom scale + center) starts and stops with no acceleration jerk. Input
    /// is clamped to [0,1]. Silkier than the cubic ease it replaced.
    static func smootherStep(_ t: Double) -> Double {
        let x = min(max(t, 0), 1)
        return x * x * x * (x * (x * 6 - 15) + 10)
    }

    // MARK: - Cursor precomputation

    /// One sample on the precomputed smoothed-cursor trajectory.
    struct CursorSample: Sendable, Equatable {
        /// Milliseconds from recording start.
        var t: Double
        /// Sprite position in video pixels (top-left origin, same space as the
        /// raw keyframes and click points).
        var pos: SIMD2<Float>
    }

    /// Integrates the smoothed cursor sprite forward across the whole recording
    /// once, at a fixed high rate, so both the editor preview and the export
    /// read an identical, frame-rate-independent glide. Mirrors the design of
    /// `computePanTrack`: a critically-damped spring chases the raw pointer
    /// with an *adaptive* smoothTime — gentle glide when the cursor is slow,
    /// tightening on speed/lag urgency and collapsing to ~zero in the click
    /// window so the sprite lands exactly on click targets.
    ///
    /// Two things make it silkier than a raw per-frame spring:
    /// - the urgency **speed** signal is EMA-smoothed, killing the frame-to-
    ///   frame noise that a bare 16 ms lookback injects into the stiffness;
    /// - the blend into tight tracking is smoothstepped (see
    ///   `CursorAnimationStyle.smoothTime`), so acceleration eases in/out.
    ///
    /// Returns [] for 0–1 keyframes (nothing to interpolate; callers fall back
    /// to the raw pointer).
    static func computeCursorTrack(
        metadata: RecordingMetadata,
        clickDownTimesMs: [Double]
    ) -> [CursorSample] {
        let frames = metadata.cursor.keyframes
        guard frames.count >= 2 else { return [] }

        let videoW = Double(max(1, metadata.video.width))
        let style: CursorAnimationStyle = metadata.zoom.config.animationStyle
            .flatMap { CursorAnimationStyle(rawValue: $0.rawValue) } ?? .slow

        // 240 Hz inner integration keeps the spring stable and matches the pan
        // track; we emit samples at ~125 Hz for the lookup table.
        let integrationHz = 240.0
        let dtSec = 1.0 / integrationHz
        let dtMs = dtSec * 1000.0
        let outputIntervalMs = 8.0
        // Pre-roll so the spring is at a settled steady state by the first
        // emitted sample (otherwise the opening frame pops from a cold start).
        let warmupMs = 300.0
        // EMA time constant for the speed signal (seconds). Short enough to
        // stay responsive, long enough to denoise the per-step velocity.
        let speedTauSec = 0.05
        let emaAlpha = 1.0 - exp(-dtSec / speedTauSec)

        let startT = frames.first!.timestamp
        let endT = frames.last!.timestamp

        // Forward-walking raw interpolator: `t` only ever increases here, so we
        // advance a keyframe cursor instead of binary-searching every step —
        // O(steps + keyframes) rather than O(steps · log keyframes).
        var kf = 0
        func rawAt(_ t: Double) -> SIMD2<Float> {
            while kf + 1 < frames.count && frames[kf + 1].timestamp <= t { kf += 1 }
            let prev = frames[kf]
            let next = (kf + 1 < frames.count) ? frames[kf + 1] : prev
            if next.timestamp > prev.timestamp {
                let a = min(max((t - prev.timestamp) / (next.timestamp - prev.timestamp), 0), 1)
                return SIMD2(
                    Float(prev.x + (next.x - prev.x) * a),
                    Float(prev.y + (next.y - prev.y) * a)
                )
            }
            return SIMD2(Float(prev.x), Float(prev.y))
        }

        var pos = rawAt(startT)              // start settled on the first sample
        var vel = SIMD2<Float>(0, 0)
        var prevTarget = pos
        var speedEMA = 0.0

        var out: [CursorSample] = []
        out.reserveCapacity(Int((endT - startT) / outputIntervalMs) + 4)

        var t = startT - warmupMs
        var lastOutputMs = -Double.greatestFiniteMagnitude
        while t <= endT {
            let target = rawAt(t)

            // Raw pointer speed (px/sec), EMA-smoothed for a stable stiffness.
            let d = target - prevTarget
            let instSpeed = Double((d.x * d.x + d.y * d.y).squareRoot()) / dtSec
            speedEMA += (instSpeed - speedEMA) * emaAlpha
            prevTarget = target

            // How far the sprite currently trails the raw pointer.
            let lagV = target - pos
            let lagPx = Double((lagV.x * lagV.x + lagV.y * lagV.y).squareRoot())

            var st = style.smoothTime(
                forSpeedPxPerSec: speedEMA, lagPx: lagPx, videoWidth: videoW
            )
            // Collapse toward the true click point inside the click window.
            st *= proximityFactor(to: clickDownTimesMs, at: t, window: 140)

            smoothDamp(pos: &pos, vel: &vel, target: target, smoothTime: st, dt: dtSec)

            if t >= startT && t - lastOutputMs >= outputIntervalMs {
                out.append(CursorSample(t: t, pos: pos))
                lastOutputMs = t
            }
            t += dtMs
        }
        // Anchor a sample exactly at endTime so the last frame reads cleanly.
        if (out.last?.t ?? -Double.greatestFiniteMagnitude) < endT {
            out.append(CursorSample(t: endT, pos: pos))
        }
        return out
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
        let cameraMaxSmoothTime: Double = 0.60
        let cameraMinSmoothTime: Double = 0.16
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
        // ~125 Hz pan samples (was 60 Hz). The renderer interpolates linearly
        // between samples, so a finer track means smoother sub-frame motion.
        let outputIntervalMs: Double = 8.0

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
                let rawUrgencyX = Float(min(1, max(0,
                    (Double(abs(smoothCursor.x - camera.x)) - Double(safeHalfX))
                    / Double(visHalfX - safeHalfX)
                )))
                let rawUrgencyY = Float(min(1, max(0,
                    (Double(abs(smoothCursor.y - camera.y)) - Double(safeHalfY))
                    / Double(visHalfY - safeHalfY)
                )))
                // Smoothstep the urgency so the follow tightens GRADUALLY as the
                // cursor nears the frame edge. A linear ramp made the camera
                // visibly "kick" into its fast-follow mode; smoothstep is C1 at
                // both ends, so the acceleration eases in and out.
                let urgencyX = rawUrgencyX * rawUrgencyX * (3 - 2 * rawUrgencyX)
                let urgencyY = rawUrgencyY * rawUrgencyY * (3 - 2 * rawUrgencyY)
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
                // Clamp the camera so the cursor can't leave the frame, but
                // only DAMP the velocity instead of zeroing it. Hard-zeroing
                // made the camera dead-stop when a fast drag hit the edge (a
                // visible jerk); keeping part of the catch-up momentum lets it
                // ride the edge smoothly with the cursor.
                if dcx > maxOffX { camera.x = smoothCursor.x - maxOffX; cameraVel.x *= 0.5 }
                else if dcx < -maxOffX { camera.x = smoothCursor.x + maxOffX; cameraVel.x *= 0.5 }
                if dcy > maxOffY { camera.y = smoothCursor.y - maxOffY; cameraVel.y *= 0.5 }
                else if dcy < -maxOffY { camera.y = smoothCursor.y + maxOffY; cameraVel.y *= 0.5 }
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
