import Foundation

/// Critically-damped SmoothDamp (Unity-style) 2D position smoother.
/// Direct port of `SmoothPosition2D` from `src/processing/smooth-motion.ts`.
struct SmoothPosition2D {
    private(set) var current: SIMD2<Double>
    private(set) var velocity: SIMD2<Double>
    var smoothTime: Double

    private static let coef1 = 0.48
    private static let coef2 = 0.235
    private static let convergence: Double = 0.001

    init(x: Double, y: Double, smoothTime: Double = 0.2) {
        self.current = SIMD2(x, y)
        self.velocity = .zero
        self.smoothTime = smoothTime
    }

    /// Pull the smoothed position toward `target` over `deltaTime` seconds.
    mutating func update(targetX: Double, targetY: Double, deltaTime: Double) -> SIMD2<Double> {
        let target = SIMD2(targetX, targetY)
        let omega = 2.0 / max(smoothTime, 0.0001)
        let xCoef = omega * deltaTime
        let exp = 1.0 / (1.0 + xCoef + Self.coef1 * xCoef * xCoef + Self.coef2 * xCoef * xCoef * xCoef)

        let change = current - target
        let temp = (velocity + omega * change) * deltaTime
        velocity = (velocity - omega * temp) * exp
        current = target + (change + temp) * exp

        return current
    }

    /// Snap to a position (use on seek so we don't try to catch up).
    mutating func reset(toX x: Double, y: Double) {
        current = SIMD2(x, y)
        velocity = .zero
    }
}

/// Maps animation-style strings (matching v1.6 metadata) to smooth-time seconds.
enum CursorAnimationStyle: String {
    case slow, mellow, quick, rapid

    /// Smooth time used when the cursor is mostly stationary or moving slow.
    var smoothTime: Double {
        switch self {
        case .slow:   return 0.45
        case .mellow: return 0.25
        case .quick:  return 0.12
        case .rapid:  return 0.06
        }
    }

    /// Smooth time used at high cursor speed.
    var minSmoothTime: Double {
        switch self {
        case .slow:   return 0.15
        case .mellow: return 0.08
        case .quick:  return 0.04
        case .rapid:  return 0.02
        }
    }

    /// Speed- and lag-adaptive smooth time. The cursor should glide gently
    /// when it's stationary or drifting (cinematic), but track *tightly* when
    /// urgency is high — otherwise a quick move leaves the smoothed sprite
    /// stranded far behind the real pointer.
    ///
    /// Two urgency signals, blending from `smoothTime` (calm) down to
    /// `minSmoothTime` (urgent) on whichever is stronger:
    /// - `speed`: raw cursor velocity — catches sustained fast moves.
    /// - `lagPx`: how far the sprite currently trails the raw pointer —
    ///   catches move-then-stop, where speed collapses to zero the instant the
    ///   move ends while the sprite is still mid-flight. Without it the
    ///   residual gap closes at full cinematic slowness ("oozing"). Because
    ///   lag shrinks as the sprite catches up, the blend relaxes on approach
    ///   and the landing still reads as a glide, not a snap.
    ///
    /// Both signals are normalised by the video width so the behaviour is
    /// resolution-independent (thresholds are widths and widths-per-second).
    func smoothTime(forSpeedPxPerSec speed: Double, lagPx: Double = 0, videoWidth: Double) -> Double {
        guard videoWidth > 0 else { return smoothTime }
        let widthsPerSec = speed / videoWidth
        let speedLo = 0.15  // below this, full cinematic glide
        let speedHi = 1.20  // at/above ~one screen-width per second, fully tight
        let speedF = min(1.0, max(0.0, (widthsPerSec - speedLo) / (speedHi - speedLo)))

        let lagNorm = lagPx / videoWidth
        let lagLo = 0.005   // within ~0.5% of the width: no urgency
        let lagHi = 0.05    // trailing 5%+ of the width: fully tight
        let lagF = min(1.0, max(0.0, (lagNorm - lagLo) / (lagHi - lagLo)))

        let f = max(speedF, lagF)
        return smoothTime + (minSmoothTime - smoothTime) * f
    }
}
