import XCTest
@testable import CineScreen

final class SpringTests: XCTestCase {
    func testSmoothDampConvergesToTarget() {
        var spring = SmoothPosition2D(x: 0, y: 0, smoothTime: 0.2)
        var pos = SIMD2<Double>(0, 0)
        for _ in 0..<300 {
            pos = spring.update(targetX: 100, targetY: 50, deltaTime: 1.0 / 60.0)
        }
        XCTAssertEqual(pos.x, 100, accuracy: 0.5)
        XCTAssertEqual(pos.y, 50, accuracy: 0.5)
    }

    /// The click window collapses smoothTime to exactly 0 at a mouse-down —
    /// the update must stay finite (omega is clamped) and effectively snap.
    func testZeroSmoothTimeIsFiniteAndSnaps() {
        var spring = SmoothPosition2D(x: 0, y: 0, smoothTime: 0)
        let pos = spring.update(targetX: 500, targetY: 500, deltaTime: 1.0 / 60.0)
        XCTAssertTrue(pos.x.isFinite && pos.y.isFinite)
        XCTAssertEqual(pos.x, 500, accuracy: 1.0)
        XCTAssertEqual(pos.y, 500, accuracy: 1.0)
    }

    func testAdaptiveBlendEndpointsAndMonotonicity() {
        let style = CursorAnimationStyle.mellow
        let w = 2000.0

        // At rest: full cinematic glide. Flat out (speed or lag): fully tight.
        XCTAssertEqual(style.smoothTime(forSpeedPxPerSec: 0, videoWidth: w), style.smoothTime)
        XCTAssertEqual(style.smoothTime(forSpeedPxPerSec: 10 * w, videoWidth: w),
                       style.minSmoothTime, accuracy: 1e-9)
        XCTAssertEqual(style.smoothTime(forSpeedPxPerSec: 0, lagPx: w, videoWidth: w),
                       style.minSmoothTime, accuracy: 1e-9)

        // Monotonically non-increasing in speed.
        var last = style.smoothTime(forSpeedPxPerSec: 0, videoWidth: w)
        for speed in stride(from: 0.0, through: 2.0 * w, by: w / 10) {
            let t = style.smoothTime(forSpeedPxPerSec: speed, videoWidth: w)
            XCTAssertLessThanOrEqual(t, last + 1e-12)
            last = t
        }

        // Degenerate width falls back to the base time rather than dividing by 0.
        XCTAssertEqual(style.smoothTime(forSpeedPxPerSec: 1e9, videoWidth: 0), style.smoothTime)
    }
}
