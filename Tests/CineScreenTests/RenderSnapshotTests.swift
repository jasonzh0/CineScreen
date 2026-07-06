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

    // MARK: - Precomputed cursor track

    /// The track is binary-searched by time (like the pan table), so its
    /// timestamps must be non-decreasing.
    func testCursorTrackIsMonotonic() {
        let metadata = Fixtures.metadata(
            keyframes: stride(from: 0.0, through: 8000, by: 40).map {
                Fixtures.keyframe($0, 200 + $0 / 8, 300)
            }
        )
        let snapshot = RenderSnapshot(metadata: metadata, zoomSections: [])
        XCTAssertFalse(snapshot.cursorSamples.isEmpty)
        for pair in zip(snapshot.cursorSamples, snapshot.cursorSamples.dropFirst()) {
            XCTAssertLessThanOrEqual(pair.0.t, pair.1.t)
        }
    }

    /// Fewer than two keyframes → nothing to interpolate; the sampler returns
    /// nil so callers fall back to the raw pointer.
    func testCursorTrackEmptyForSparseKeyframes() {
        let none = RenderSnapshot(metadata: Fixtures.metadata(), zoomSections: [])
        XCTAssertTrue(none.cursorSamples.isEmpty)
        XCTAssertNil(none.smoothedCursorPosition(atMilliseconds: 1000))

        let one = RenderSnapshot(
            metadata: Fixtures.metadata(keyframes: [Fixtures.keyframe(0, 10, 20)]),
            zoomSections: []
        )
        XCTAssertTrue(one.cursorSamples.isEmpty)
    }

    /// A stationary cursor must resolve to exactly that position — the spring
    /// is warmed up and at rest, so there's no drift or overshoot.
    func testCursorTrackSettlesOnStationaryCursor() {
        let metadata = Fixtures.metadata(
            keyframes: [Fixtures.keyframe(0, 640, 480), Fixtures.keyframe(5000, 640, 480)]
        )
        let snapshot = RenderSnapshot(metadata: metadata, zoomSections: [])
        let p = snapshot.smoothedCursorPosition(atMilliseconds: 2500)
        XCTAssertEqual(Double(p?.x ?? -1), 640, accuracy: 0.01)
        XCTAssertEqual(Double(p?.y ?? -1), 480, accuracy: 0.01)
    }

    /// Same metadata in, byte-identical track out — the glide is deterministic,
    /// which is what guarantees editor preview == export.
    func testCursorTrackIsDeterministic() {
        let make = {
            RenderSnapshot(
                metadata: Fixtures.metadata(
                    keyframes: stride(from: 0.0, through: 4000, by: 50).map {
                        Fixtures.keyframe($0, 100 + $0 / 4, 200 + $0 / 8)
                    }
                ),
                zoomSections: []
            )
        }
        XCTAssertEqual(make().cursorSamples, make().cursorSamples)
    }

    /// The smoothing collapses inside the click window, so at a mouse-down the
    /// sprite sits (essentially) on the true click point — where lag is most
    /// visible. Away from clicks the sprite trails the fast-moving pointer.
    func testCursorTrackCollapsesAtClick() {
        // Cursor sweeps 0→3000px over 3s; a click lands at t=1500 (x≈1500).
        let metadata = Fixtures.metadata(
            keyframes: stride(from: 0.0, through: 3000, by: 20).map {
                Fixtures.keyframe($0, $0, 500)
            },
            clicks: [Fixtures.click(1500, x: 1500, y: 500, action: .down)]
        )
        let snapshot = RenderSnapshot(metadata: metadata, zoomSections: [])
        let rawClick = RenderSnapshot.rawCursorPosition(atMilliseconds: 1500, metadata: metadata)!
        let atClick = snapshot.smoothedCursorPosition(atMilliseconds: 1500)!
        let gapAtClick = abs(Double(atClick.x - rawClick.x))

        // Mid-move, far from any click, the glide deliberately trails the
        // fast-moving pointer.
        let rawMid = RenderSnapshot.rawCursorPosition(atMilliseconds: 800, metadata: metadata)!
        let atMid = snapshot.smoothedCursorPosition(atMilliseconds: 800)!
        XCTAssertLessThan(Double(atMid.x), Double(rawMid.x))
        let gapMid = abs(Double(atMid.x - rawMid.x))

        // The collapse pulls the sprite dramatically closer to the true pointer
        // at the click than during the free glide — that's what lands the
        // sprite on click targets.
        XCTAssertLessThan(gapAtClick, gapMid * 0.5)
        XCTAssertLessThan(gapAtClick, 0.01 * Double(metadata.video.width)) // <1% of frame
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
