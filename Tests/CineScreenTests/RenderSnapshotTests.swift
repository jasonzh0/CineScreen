import XCTest
@testable import CineScreen

final class RenderSnapshotTests: XCTestCase {
    func testProximityFactorBinarySearch() {
        let times = [1000.0, 2000.0]
        XCTAssertEqual(RenderSnapshot.proximityFactor(to: times, at: 1000, window: 140), 0)
        XCTAssertEqual(RenderSnapshot.proximityFactor(to: times, at: 1070, window: 140), 0.5, accuracy: 1e-9)
        XCTAssertEqual(RenderSnapshot.proximityFactor(to: times, at: 1500, window: 140), 1)
        XCTAssertEqual(RenderSnapshot.proximityFactor(to: times, at: 500, window: 140), 1)
        XCTAssertEqual(RenderSnapshot.proximityFactor(to: times, at: 2010, window: 140), 10.0 / 140.0, accuracy: 1e-9)
        XCTAssertEqual(RenderSnapshot.proximityFactor(to: [], at: 0, window: 140), 1)
    }

    /// The smoothing collapse keys off mouse-DOWNs only — an up (e.g. a drag
    /// release, often far from any ring) must not snap the sprite.
    func testMouseUpsDoNotCollapseSmoothing() {
        let metadata = Fixtures.metadata(
            keyframes: [Fixtures.keyframe(0, 100, 100), Fixtures.keyframe(5000, 100, 100)],
            clicks: [Fixtures.click(1000, action: .down), Fixtures.click(1600, action: .up)]
        )
        let snapshot = RenderSnapshot(metadata: metadata, zoomSections: [])
        XCTAssertEqual(snapshot.adaptiveCursorSmoothTime(atMilliseconds: 1000), 0, accuracy: 1e-9)
        XCTAssertEqual(
            snapshot.adaptiveCursorSmoothTime(atMilliseconds: 1600),
            CursorAnimationStyle.mellow.smoothTime,
            accuracy: 1e-9
        )
    }

    /// A sprite trailing far behind a stationary pointer must tighten —
    /// the move-then-hover case, where speed alone reads as calm.
    func testLagUrgencyTightensSmoothTime() {
        let metadata = Fixtures.metadata(
            keyframes: [Fixtures.keyframe(0, 0, 0), Fixtures.keyframe(5000, 0, 0)]
        )
        let snapshot = RenderSnapshot(metadata: metadata, zoomSections: [])
        let calm = snapshot.adaptiveCursorSmoothTime(atMilliseconds: 2500, spriteAt: SIMD2(0, 0))
        let lagging = snapshot.adaptiveCursorSmoothTime(atMilliseconds: 2500, spriteAt: SIMD2(500, 0))
        XCTAssertLessThan(lagging, calm)
        XCTAssertEqual(lagging, CursorAnimationStyle.mellow.minSmoothTime, accuracy: 1e-9)
    }

    func testZoomStateRampAndIdentity() {
        let metadata = Fixtures.metadata(
            keyframes: [Fixtures.keyframe(0, 1000, 500), Fixtures.keyframe(10_000, 1000, 500)],
            sections: [Fixtures.section(1000, 5000)]
        )
        let snapshot = RenderSnapshot(metadata: metadata, zoomSections: metadata.zoom.sections)
        XCTAssertEqual(snapshot.zoomState(atMilliseconds: 500).scale, 1.0)
        XCTAssertEqual(snapshot.zoomState(atMilliseconds: 1000).scale, 1.0, accuracy: 1e-4)
        XCTAssertEqual(snapshot.zoomState(atMilliseconds: 3000).scale, 2.0, accuracy: 1e-4)
        XCTAssertEqual(snapshot.zoomState(atMilliseconds: 6000).scale, 1.0)
    }

    /// The pan lookup table is binary-searched by time — it must be
    /// monotonic no matter how many sections feed it.
    func testPanSamplesAreMonotonic() {
        let metadata = Fixtures.metadata(
            keyframes: stride(from: 0.0, through: 10_000, by: 50).map {
                Fixtures.keyframe($0, 500 + $0 / 10, 400)
            },
            sections: [Fixtures.section(1000, 4000), Fixtures.section(6000, 9000)]
        )
        let snapshot = RenderSnapshot(metadata: metadata, zoomSections: metadata.zoom.sections)
        XCTAssertFalse(snapshot.panSamples.isEmpty)
        for pair in zip(snapshot.panSamples, snapshot.panSamples.dropFirst()) {
            XCTAssertLessThanOrEqual(pair.0.t, pair.1.t)
        }
    }

    /// Defensive sort: old metadata files may carry sections in drag order.
    func testInitSortsSections() {
        let metadata = Fixtures.metadata(
            sections: [Fixtures.section(6000, 9000), Fixtures.section(1000, 4000)]
        )
        let snapshot = RenderSnapshot(metadata: metadata, zoomSections: metadata.zoom.sections)
        XCTAssertEqual(snapshot.zoomSections.map(\.startTime), [1000, 6000])
    }

    func testRawCursorPositionInterpolatesAndClamps() {
        let metadata = Fixtures.metadata(
            keyframes: [Fixtures.keyframe(0, 0, 0), Fixtures.keyframe(1000, 100, 200)]
        )
        let mid = RenderSnapshot.rawCursorPosition(atMilliseconds: 500, metadata: metadata)
        XCTAssertEqual(Double(mid?.x ?? -1), 50, accuracy: 0.001)
        XCTAssertEqual(Double(mid?.y ?? -1), 100, accuracy: 0.001)
        let past = RenderSnapshot.rawCursorPosition(atMilliseconds: 5000, metadata: metadata)
        XCTAssertEqual(Double(past?.x ?? -1), 100, accuracy: 0.001)
        XCTAssertNil(RenderSnapshot.rawCursorPosition(atMilliseconds: 0, metadata: Fixtures.metadata()))
    }
}
